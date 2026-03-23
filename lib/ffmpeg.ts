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

const ffprobeBin = join(process.cwd(), "node_modules", "ffprobe-static", "bin", process.platform, process.arch, "ffprobe");
ffmpeg.setFfprobePath(ffprobeBin);

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

export function isVideoMime(mime: string): boolean {
  return VIDEO_MIME_TYPES.has(mime);
}

/** 비디오 파일 경로에서 오디오 트랙만 MP3로 추출한다. videoPath는 호출자가 관리한다. */
export async function extractAudio(videoPath: string): Promise<Buffer> {
  const id = randomUUID();
  const audioPath = join(tmpdir(), `${id}-audio.mp3`);

  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .outputOptions(["-vn", "-c:a", "libmp3lame", "-q:a", "4"])
      .save(audioPath)
      .on("end", () => resolve())
      .on("error", reject);
  });

  const output = await readFile(audioPath);
  await unlink(audioPath).catch(() => {});
  return output;
}

function getMediaDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) reject(err);
      else resolve(metadata.format.duration ?? 0);
    });
  });
}

/** 더빙 오디오를 원본 영상에 합성한다. 출력 길이는 원본 영상 길이에 맞춘다. */
export async function muxVideoWithAudio(
  videoPath: string,
  audioBuffer: Buffer,
  videoMime: string,
  outputMime?: string
): Promise<Buffer> {
  const targetMime = outputMime ?? videoMime;
  const outputExt = targetMime === "video/quicktime" ? "mov" : targetMime.split("/")[1];
  const id = randomUUID();
  const audioPath = join(tmpdir(), `${id}-audio.mp3`);
  const outputPath = join(tmpdir(), `${id}-output.${outputExt}`);

  await writeFile(audioPath, audioBuffer);

  const videoDuration = await getMediaDuration(videoPath);

  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      .outputOptions([
        "-c:v copy",
        "-map 0:v:0",
        "-map 1:a:0",
        `-t ${videoDuration}`,
      ])
      .save(outputPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(err));
  });

  const output = await readFile(outputPath);
  await Promise.all([audioPath, outputPath].map((p) => unlink(p).catch(() => {})));
  return output;
}
