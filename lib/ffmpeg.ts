import ffmpeg from "fluent-ffmpeg";
import { execFile } from "child_process";
import { promisify } from "util";
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

const execFileAsync = promisify(execFile);

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

export interface AudioSegment {
  start: number; // seconds
  end: number;   // seconds
}

/**
 * FFmpeg silencedetect 필터로 오디오/비디오 파일에서 발화 구간을 검출한다.
 * 진폭이 -35dB 이하인 구간을 묵음으로 간주하고, 그 역을 발화 구간으로 반환한다.
 */
export async function detectSpeechSegments(
  filePath: string,
  totalDuration: number
): Promise<AudioSegment[]> {
  const result = await execFileAsync(ffmpegBin, [
    "-i", filePath,
    "-af", "silencedetect=noise=-35dB:duration=0.3",
    "-f", "null", "-",
  ]).catch((e: unknown) => e as { stderr?: string });

  const stderr = (result as { stderr?: string }).stderr ?? "";

  // silence_start / silence_end 파싱
  const silences: AudioSegment[] = [];
  let silenceStart: number | null = null;
  for (const line of stderr.split("\n")) {
    const sStart = line.match(/silence_start:\s*([\d.]+)/);
    const sEnd   = line.match(/silence_end:\s*([\d.]+)/);
    if (sStart) silenceStart = parseFloat(sStart[1]);
    if (sEnd && silenceStart !== null) {
      silences.push({ start: silenceStart, end: parseFloat(sEnd[1]) });
      silenceStart = null;
    }
  }
  if (silenceStart !== null) silences.push({ start: silenceStart, end: totalDuration });

  // 묵음의 역 → 발화 구간
  const speeches: AudioSegment[] = [];
  let pos = 0;
  for (const s of silences) {
    if (s.start - pos > 0.05) speeches.push({ start: pos, end: s.start });
    pos = s.end;
  }
  if (totalDuration - pos > 0.05) speeches.push({ start: pos, end: totalDuration });

  return speeches;
}

/**
 * atempo 필터는 한 단계당 [0.5, 2.0] 범위만 지원하므로
 * 범위를 벗어나는 비율은 여러 단계로 체인한다.
 */
function buildAtempoFilter(ratio: number): string {
  const steps: string[] = [];
  let r = ratio;
  while (r > 2.0) { steps.push("atempo=2.0"); r /= 2.0; }
  while (r < 0.5) { steps.push("atempo=0.5"); r /= 0.5; }
  steps.push(`atempo=${r.toFixed(6)}`);
  return steps.join(",");
}

function getMediaDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) reject(err);
      else resolve(metadata.format.duration ?? 0);
    });
  });
}

/**
 * 더빙 오디오의 각 발화를 원본 발화 타이밍에 정확히 배치한다.
 * - N번째 더빙 발화 → N번째 원본 발화 시작 위치로 이동
 * - 더빙 발화 길이가 원본 발화 길이와 다르면 atempo로 개별 조절
 * - 묵음 구간은 원본과 동일하게 유지
 */
async function buildSyncedAudio(
  dubbedPath: string,
  dubbedSegs: AudioSegment[],
  origSegs: AudioSegment[],
  videoDuration: number,
): Promise<string | null> {
  const count = Math.min(dubbedSegs.length, origSegs.length);
  if (count === 0) return null;

  const id = randomUUID();
  const outputPath = join(tmpdir(), `${id}-synced.mp3`);

  // filter_complex: 각 더빙 발화를 원본 위치로 배치
  // [0:a]atrim=...,asetpts=PTS-STARTPTS,atempo=RATIO,adelay=DELAY_MS[gN]
  // → amix로 합산
  const filterParts: string[] = [];
  const labels: string[] = [];

  for (let i = 0; i < count; i++) {
    const orig    = origSegs[i];
    const dub     = dubbedSegs[i];
    const origDur = orig.end - orig.start;
    const dubDur  = dub.end  - dub.start;
    const ratio   = dubDur / origDur;
    const delayMs = Math.round(orig.start * 1000);
    const label   = `g${i}`;

    filterParts.push(
      `[0:a]atrim=start=${dub.start}:end=${dub.end},asetpts=PTS-STARTPTS,${buildAtempoFilter(ratio)},adelay=${delayMs}|${delayMs}[${label}]`
    );
    labels.push(`[${label}]`);
  }

  filterParts.push(
    `${labels.join("")}amix=inputs=${count}:duration=longest:normalize=0[out]`
  );

  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(dubbedPath)
      .addOption("-filter_complex", filterParts.join(";"))
      .addOption("-map", "[out]")
      .addOption("-t", String(videoDuration))
      .save(outputPath)
      .on("end", () => resolve())
      .on("error", reject);
  });

  return outputPath;
}

/** Mux muted video with dubbed audio, returns the output video buffer.
 *  파형 분석(silencedetect)으로 발화 구간을 검출하고 각 발화를 원본 타이밍에 배치한다.
 */
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

  const [videoDuration, audioDuration] = await Promise.all([
    getMediaDuration(videoPath),
    getMediaDuration(audioPath),
  ]);

  // 파형 분석: 원본·더빙 오디오에서 발화 구간 검출
  const [origSegs, dubbedSegs] = await Promise.all([
    detectSpeechSegments(videoPath, videoDuration),
    detectSpeechSegments(audioPath, audioDuration),
  ]);

  // 발화별 싱크 맞추기
  const syncedAudioPath = await buildSyncedAudio(
    audioPath, dubbedSegs, origSegs, videoDuration
  );
  const finalAudioPath = syncedAudioPath ?? audioPath;

  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(finalAudioPath)
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

  const cleanupPaths = [videoPath, audioPath, outputPath];
  if (syncedAudioPath) cleanupPaths.push(syncedAudioPath);
  await Promise.all(cleanupPaths.map((p) => unlink(p).catch(() => {})));

  return output;
}
