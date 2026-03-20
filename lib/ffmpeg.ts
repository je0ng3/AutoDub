import ffmpeg from "fluent-ffmpeg";
import { randomUUID } from "crypto";
import { writeFile, readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

// ffmpeg-static records the install-time absolute path, which breaks when the
// Next.js process runs under a different root (e.g. /ROOT/...). Resolve from
// process.cwd() at runtime instead.
const ffmpegBin = join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg");
ffmpeg.setFfmpegPath(ffmpegBin);

const VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/webm",
  "video/x-matroska",
  "video/mpeg",
]);

export function isVideoFile(file: File): boolean {
  return VIDEO_MIME_TYPES.has(file.type);
}

/** Crop video and move moov atom to front for ElevenLabs stream-reading. */
export async function cropAndPrepareVideo(
  videoBuffer: Buffer,
  videoMime: string,
  startSec: number,
  durationSec?: number
): Promise<Buffer> {
  const ext = videoMime === "video/quicktime" ? "mov" : videoMime.split("/")[1];
  const id = randomUUID();
  const inputPath = join(tmpdir(), `${id}-input.${ext}`);
  const outputPath = join(tmpdir(), `${id}-cropped.mp4`);

  if (videoBuffer.length === 0) {
    throw new Error(`cropAndPrepareVideo: 빈 버퍼 (mime: ${videoMime})`);
  }

  await writeFile(inputPath, videoBuffer);

  const outputOptions = ["-c copy", "-movflags +faststart"];
  if (startSec > 0) {
    outputOptions.unshift(`-ss ${startSec}`);
  }
  if (durationSec !== undefined && isFinite(durationSec)) {
    outputOptions.push(`-t ${durationSec}`);
  }

  await new Promise<void>((resolve, reject) => {
    const atomSize = videoBuffer.length >= 4 ? videoBuffer.readUInt32BE(0) : -1;
    const atomType = videoBuffer.length >= 8
      ? videoBuffer.subarray(4, 8).toString("ascii").replace(/[^\x20-\x7E]/g, "?")
      : "N/A";

    ffmpeg()
      .input(inputPath)
      .outputOptions(outputOptions)
      .save(outputPath)
      .on("end", () => resolve())
      .on("error", (err) =>
        reject(new Error(
          `cropAndPrepareVideo 실패 (버퍼 ${videoBuffer.length}B, ` +
          `첫 atom: size=${atomSize} type="${atomType}"): ${err.message}`
        ))
      );
  });

  const output = await readFile(outputPath);
  await Promise.all([unlink(inputPath), unlink(outputPath)]);

  return output;
}

/** Mux muted video with dubbed audio, returns the output video buffer. */
export async function muxVideoWithAudio(
  videoBuffer: Buffer,
  audioBuffer: Buffer,
  videoMime: string
): Promise<Buffer> {
  const ext = videoMime === "video/quicktime" ? "mov" : videoMime.split("/")[1];
  const id = randomUUID();
  const videoPath = join(tmpdir(), `${id}-video.${ext}`);
  const audioPath = join(tmpdir(), `${id}-audio.mp3`);
  const outputPath = join(tmpdir(), `${id}-output.${ext}`);

  await Promise.all([
    writeFile(videoPath, videoBuffer),
    writeFile(audioPath, audioBuffer),
  ]);

  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      .outputOptions([
        "-c:v copy",   // 비디오 스트림 그대로
        "-map 0:v:0",  // 원본 영상 트랙
        "-map 1:a:0",  // 더빙 음성 트랙
      ])
      .save(outputPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(err));
  });

  const output = await readFile(outputPath);
  await Promise.all([unlink(videoPath), unlink(audioPath), unlink(outputPath)]);

  return output;
}