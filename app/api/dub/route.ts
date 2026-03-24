import { randomUUID } from "crypto";
import { join } from "path";
import { tmpdir } from "os";
import { writeFile, readFile, unlink } from "fs/promises";
import { del } from "@vercel/blob";
import { getDubbedAudio, getDubbingStatus, startDubbing } from "@/lib/elevenlabs";
import { extractAudio, isVideoMime, muxVideoWithAudio } from "@/lib/ffmpeg";

// 인메모리 결과 저장소 (단일 인스턴스 전용 — 프로덕션에서는 오브젝트 스토리지로 교체)
export const results = new Map<string, { buffer: Buffer; mimeType: string; filename: string }>();

function send(controller: ReadableStreamDefaultController, data: object) {
  const encoder = new TextEncoder();
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
}

export async function POST(req: Request) {
  const targetLang = req.headers.get("x-target-lang");
  const fileType = req.headers.get("x-file-type") ?? "application/octet-stream";
  const fileName = decodeURIComponent(req.headers.get("x-file-name") ?? "file");
  const blobUrl = req.headers.get("x-blob-url");
  const originalFileType = req.headers.get("x-original-file-type") ?? fileType;
  const originalFileName = decodeURIComponent(req.headers.get("x-original-file-name") ?? fileName);
  if (!targetLang) {
    return new Response("Missing targetLang", { status: 400 });
  }
  if (!blobUrl) {
    return new Response("Missing blob URL", { status: 400 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      let videoTmpPath: string | null = null;
      let audioTmpPath: string | null = null;
      try {
        // blob fetch를 stream 내부에서 수행해 arrayBuffer를 디스크 기록 후 GC 허용
        const blobRes = await fetch(blobUrl);
        if (!blobRes.ok) throw new Error("Failed to fetch uploaded file");
        let arrayBuffer: ArrayBuffer | null = await blobRes.arrayBuffer();
        await del(blobUrl);
        if (!arrayBuffer.byteLength) throw new Error("Empty body");

        send(controller, { step: "transcribing" });

        const isVideo = isVideoMime(fileType);

        if (isVideo) {
          // 비디오: 디스크에 한 번만 기록 → extractAudio · muxVideoWithAudio가 경로 공유
          const ext = fileType === "video/quicktime" ? "mov" : fileType.split("/")[1];
          videoTmpPath = join(tmpdir(), `${randomUUID()}-video.${ext}`);
          await writeFile(videoTmpPath, Buffer.from(arrayBuffer));
          arrayBuffer = null; // 더빙 대기 중 GC 허용

          audioTmpPath = join(tmpdir(), `${randomUUID()}-dubbing-audio.mp3`);
          await writeFile(audioTmpPath, await extractAudio(videoTmpPath));
        } else {
          // 오디오: File 생성자 복사 없이 디스크 기록 후 ReadStream 전달
          const ext = fileType.split("/")[1] ?? "bin";
          audioTmpPath = join(tmpdir(), `${randomUUID()}-audio.${ext}`);
          await writeFile(audioTmpPath, Buffer.from(arrayBuffer));
          arrayBuffer = null;
        }

        const audioMime = isVideo ? "audio/mpeg" : fileType;
        const audioBlob = new Blob([await readFile(audioTmpPath!)], { type: audioMime });
        const dubbingId = await startDubbing(audioBlob, targetLang);

        // 2-3단계: 완료될 때까지 폴링하면서 UI 단계 진행
        let pollCount = 0;
        while (true) {
          const status = await getDubbingStatus(dubbingId);

          if (pollCount === 1) send(controller, { step: "translating" });
          if (pollCount === 3) send(controller, { step: "synthesizing" });

          if (status === "dubbed") break;
          if (status === "failed") throw new Error("ElevenLabs dubbing failed");

          pollCount++;
          await new Promise((r) => setTimeout(r, 3000));
        }

        // 진행 단계 표시
        if (pollCount < 1) send(controller, { step: "translating" });
        if (pollCount < 3) send(controller, { step: "synthesizing" });

        // 결과 오디오 가져오기
        const audioBuffer = await getDubbedAudio(dubbingId, targetLang);

        let buffer: Buffer;
        let mimeType: string;
        let filename: string;

        if (isVideo && videoTmpPath) {
          buffer = await muxVideoWithAudio(videoTmpPath, audioBuffer, fileType, originalFileType);
          mimeType = originalFileType;
          const origExt = originalFileName.includes(".")
            ? originalFileName.split(".").pop()
            : originalFileType === "video/quicktime" ? "mov" : originalFileType.split("/")[1];
          filename = `dubbed.${origExt}`;
        } else {
          buffer = audioBuffer;
          mimeType = "audio/mpeg";
          filename = "dubbed.mp3";
        }

        const resultId = randomUUID();
        results.set(resultId, { buffer, mimeType, filename });
        setTimeout(() => results.delete(resultId), 10 * 60 * 1000); // 10분 후 자동 삭제

        send(controller, { step: "done", resultId });
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        let message = raw;
        try {
          const parsed = JSON.parse(raw);
          const detail = parsed?.detail ?? parsed;
          if (detail?.code === "quota_exceeded") {
            message = "ElevenLabs 크레딧이 부족합니다. 플랜을 업그레이드하거나 다음 달 초기화를 기다려 주세요.";
          } else if (detail?.message) {
            message = detail.message;
          }
        } catch { /* raw가 JSON이 아닌 경우 그대로 사용 */ }
        send(controller, { step: "error", message });
      } finally {
        await Promise.all([
          videoTmpPath ? unlink(videoTmpPath).catch(() => {}) : Promise.resolve(),
          audioTmpPath ? unlink(audioTmpPath).catch(() => {}) : Promise.resolve(),
        ]);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const resultId = searchParams.get("resultId");

  if (!resultId) return new Response("Missing resultId", { status: 400 });

  const result = results.get(resultId);
  if (!result) return new Response("Result not found or expired", { status: 404 });

  const total = result.buffer.byteLength;
  const rangeHeader = req.headers.get("range");

  const baseHeaders = {
    "Content-Type": result.mimeType,
    "Content-Disposition": `inline; filename="${result.filename}"`,
    "Accept-Ranges": "bytes",
  };

  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (!match) return new Response("Invalid Range", { status: 416 });

    const start = parseInt(match[1], 10);
    const end = match[2] ? parseInt(match[2], 10) : total - 1;

    if (start > end || end >= total) {
      return new Response("Range Not Satisfiable", {
        status: 416,
        headers: { "Content-Range": `bytes */${total}` },
      });
    }

    const chunk = result.buffer.subarray(start, end + 1);
    return new Response(chunk as unknown as BodyInit, {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Content-Length": String(chunk.byteLength),
      },
    });
  }

  return new Response(result.buffer as unknown as BodyInit, {
    headers: {
      ...baseHeaders,
      "Content-Length": String(total),
    },
  });
}
