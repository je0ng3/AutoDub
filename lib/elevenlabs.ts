import type { ReadStream } from "fs";
import { ElevenLabsClient } from "elevenlabs";

export const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY!,
});

export async function startDubbing(
  file: File | ReadStream | Blob,
  targetLang: string
): Promise<string> {
  const result = await elevenlabs.dubbing.dubAVideoOrAnAudioFile({
    file,
    target_lang: targetLang,
    mode: "automatic",
    watermark: true,
  });
  return result.dubbing_id;
}

export async function getDubbingStatus(
  dubbingId: string
): Promise<"dubbing" | "dubbed" | "failed"> {
  const metadata =
    await elevenlabs.dubbing.getDubbingProjectMetadata(dubbingId);
  return metadata.status as "dubbing" | "dubbed" | "failed";
}

export async function getDubbedAudio(
  dubbingId: string,
  targetLang: string
): Promise<Buffer> {
  const stream = (await elevenlabs.dubbing.getDubbedFile(
    dubbingId,
    targetLang
  )) as unknown as AsyncIterable<Uint8Array>;

  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
