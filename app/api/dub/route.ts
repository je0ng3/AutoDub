import { randomUUID } from "crypto";
import { getDubbedAudio, getDubbingStatus, startDubbing } from "@/lib/elevenlabs";
import { isVideoFile, muxVideoWithAudio } from "@/lib/ffmpeg";

// 인메모리 결과 저장소 (단일 인스턴스 전용 — 프로덕션에서는 오브젝트 스토리지로 교체)
const results = new Map<string, { buffer: Buffer; mimeType: string; filename: string }>();

function send(controller: ReadableStreamDefaultController, data: object) {
  const encoder = new TextEncoder();
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
}

export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const targetLang = formData.get("targetLang") as string | null;

  if (!file || !targetLang) {
    return new Response("Missing file or targetLang", { status: 400 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // 1단계: STT (ElevenLabs 더빙 내부에서 전사 시작)
        send(controller, { step: "transcribing" });
        const dubbingId = await startDubbing(file, targetLang);

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
          const videoBuffer = Buffer.from(await file.arrayBuffer());
          buffer = await muxVideoWithAudio(videoBuffer, audioBuffer, file.type);
          mimeType = file.type;
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
        send(controller, {
          step: "error",
          message: err instanceof Error ? err.message : "알 수 없는 오류",
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
