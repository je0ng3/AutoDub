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
        "-shortest",   // 짧은 쪽 기준으로 종료
      ])
      .save(outputPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(err));
  });

  const output = await readFile(outputPath);
  await Promise.all([unlink(videoPath), unlink(audioPath), unlink(outputPath)]);

  return output;
}