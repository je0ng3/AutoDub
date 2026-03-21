import { randomUUID } from "crypto";
import { del } from "@vercel/blob";
import { getDubbedAudio, getDubbingStatus, startDubbing } from "@/lib/elevenlabs";
import { isVideoFile, muxVideoWithAudio, cropAndPrepareVideo } from "@/lib/ffmpeg";

// 인메모리 결과 저장소 (단일 인스턴스 전용 — 프로덕션에서는 오브젝트 스토리지로 교체)
const results = new Map<string, { buffer: Buffer; mimeType: string; filename: string }>();

function send(controller: ReadableStreamDefaultController, data: object) {
  const encoder = new TextEncoder();
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
}

export async function POST(req: Request) {
  const targetLang = req.headers.get("x-target-lang");
  const fileType = req.headers.get("x-file-type") ?? "application/octet-stream";
  const fileName = decodeURIComponent(req.headers.get("x-file-name") ?? "file");
  const blobUrl = req.headers.get("x-blob-url");
  if (!targetLang) {
    return new Response("Missing targetLang", { status: 400 });
  }
  if (!blobUrl) {
    return new Response("Missing blob URL", { status: 400 });
  }

  const cropStartHeader = req.headers.get("x-crop-start");
  const cropEndHeader = req.headers.get("x-crop-end");

  const blobRes = await fetch(blobUrl);
  if (!blobRes.ok) {
    return new Response("Failed to fetch uploaded file", { status: 500 });
  }
  const arrayBuffer = await blobRes.arrayBuffer();
  await del(blobUrl);

  if (!arrayBuffer.byteLength) {
    return new Response("Empty body", { status: 400 });
  }

  const file = new File([arrayBuffer], fileName, { type: fileType });

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // 1단계: STT (ElevenLabs 더빙 내부에서 전사 시작)
        send(controller, { step: "transcribing" });

        // 비디오: 서버에서 크롭 + moov atom 앞으로 이동
        // (클라이언트 WASM stream copy는 컨테이너를 깨뜨리므로 서버에서 처리)
        let fileForDubbing = file;
        let preparedVideoBuffer: Buffer | null = null;
        if (isVideoFile(file)) {
          const startSec = cropStartHeader ? parseFloat(cropStartHeader) : 0;
          const endSec = cropEndHeader ? parseFloat(cropEndHeader) : NaN;
          const durationSec = isNaN(endSec) ? undefined : endSec - startSec;
          // File 래퍼를 거치지 않고 req.arrayBuffer()에서 직접 복사
          const raw = Buffer.from(new Uint8Array(arrayBuffer));
          preparedVideoBuffer = await cropAndPrepareVideo(raw, file.type, startSec, durationSec);
          fileForDubbing = new File([new Uint8Array(preparedVideoBuffer)], file.name, { type: "video/mp4" });
        }

        const dubbingId = await startDubbing(fileForDubbing, targetLang);

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

        if (isVideoFile(file)) {
          // preparedVideoBuffer는 반드시 존재 (위에서 video 분기에서 설정됨)
          buffer = await muxVideoWithAudio(preparedVideoBuffer!, audioBuffer, "video/mp4");
          mimeType = "video/mp4";
          filename = "dubbed.mp4";
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
        send(controller, {
          step: "error",
          message,
        });
      } finally {
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

  return new Response(result.buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": result.mimeType,
      "Content-Disposition": `attachment; filename="${result.filename}"`,
    },
  });
}
