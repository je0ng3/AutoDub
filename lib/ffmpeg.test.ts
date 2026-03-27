// @vitest-environment node
import { execFile } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { readFile, writeFile, unlink } from "fs/promises";
import { isVideoFile, muxVideoWithAudio, extractAudio } from "./ffmpeg";

async function writeToTmp(buffer: Buffer, ext: string): Promise<string> {
  const tmpPath = join(tmpdir(), `${randomUUID()}.${ext}`);
  await writeFile(tmpPath, buffer);
  return tmpPath;
}

const execFileAsync = promisify(execFile);
const ffmpegBin = join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg");

/** lavfi로 합성 비디오 버퍼 생성 */
async function makeTestVideo(durationSec: number, format: "mp4" | "mov" = "mp4"): Promise<Buffer> {
  const outputPath = join(tmpdir(), `${randomUUID()}.${format}`);
  await execFileAsync(ffmpegBin, [
    "-f", "lavfi", "-i", `testsrc=duration=${durationSec}:size=160x120:rate=10`,
    "-f", "lavfi", "-i", `sine=frequency=440:duration=${durationSec}`,
    "-c:v", "libx264", "-c:a", "aac",
    "-t", String(durationSec),
    "-y", outputPath,
  ]);
  const buf = await readFile(outputPath);
  await unlink(outputPath);
  return buf;
}

/** lavfi로 합성 WebM 비디오 버퍼 생성 */
async function makeTestVideoWebM(durationSec: number): Promise<Buffer> {
  const outputPath = join(tmpdir(), `${randomUUID()}.webm`);
  await execFileAsync(ffmpegBin, [
    "-f", "lavfi", "-i", `testsrc=duration=${durationSec}:size=160x120:rate=10`,
    "-f", "lavfi", "-i", `sine=frequency=440:duration=${durationSec}`,
    "-c:v", "libvpx", "-c:a", "libvorbis",
    "-t", String(durationSec),
    "-y", outputPath,
  ]);
  const buf = await readFile(outputPath);
  await unlink(outputPath);
  return buf;
}

/** lavfi로 합성 오디오 버퍼 생성 */
async function makeTestAudio(durationSec: number): Promise<Buffer> {
  const outputPath = join(tmpdir(), `${randomUUID()}.mp3`);
  await execFileAsync(ffmpegBin, [
    "-f", "lavfi", "-i", `sine=frequency=440:duration=${durationSec}`,
    "-c:a", "libmp3lame",
    "-t", String(durationSec),
    "-y", outputPath,
  ]);
  const buf = await readFile(outputPath);
  await unlink(outputPath);
  return buf;
}

/** ffmpeg -i 로 duration 파싱 (ffmpeg은 -i만 쓰면 코드 1로 종료하지만 stderr에 정보 출력) */
async function getDuration(buffer: Buffer, ext: string): Promise<number> {
  const inputPath = join(tmpdir(), `${randomUUID()}.${ext}`);
  await writeFile(inputPath, buffer);
  try {
    const err = await execFileAsync(ffmpegBin, ["-i", inputPath]).catch((e) => e);
    const output: string = (err as { stderr?: string; message?: string }).stderr ?? (err as { message?: string }).message ?? "";
    const match = output.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
    if (!match) throw new Error(`Duration not found. FFmpeg output:\n${output}`);
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + parseFloat(match[3]);
  } finally {
    await unlink(inputPath).catch(() => {});
  }
}

/** FFmpeg 출력에서 오디오 스트림 포함 여부를 확인한다 */
async function hasAudioStream(buffer: Buffer, ext: string): Promise<boolean> {
  const inputPath = join(tmpdir(), `${randomUUID()}.${ext}`);
  await writeFile(inputPath, buffer);
  try {
    const err = await execFileAsync(ffmpegBin, ["-i", inputPath]).catch((e) => e);
    const output: string = (err as { stderr?: string; message?: string }).stderr ?? (err as { message?: string }).message ?? "";
    return output.includes("Audio:");
  } finally {
    await unlink(inputPath).catch(() => {});
  }
}

// ─── isVideoFile ──────────────────────────────────────────────────────────────

describe("isVideoFile", () => {
  it("video/mp4는 video로 판별한다", () => {
    const file = new File([], "test.mp4", { type: "video/mp4" });
    expect(isVideoFile(file)).toBe(true);
  });

  it("video/webm은 video로 판별한다", () => {
    const file = new File([], "test.webm", { type: "video/webm" });
    expect(isVideoFile(file)).toBe(true);
  });

  it("audio/mpeg는 video로 판별하지 않는다", () => {
    const file = new File([], "test.mp3", { type: "audio/mpeg" });
    expect(isVideoFile(file)).toBe(false);
  });
});

// ─── extractAudio ─────────────────────────────────────────────────────────────

describe("extractAudio", () => {
  it("MP4 비디오에서 오디오를 추출하면 유효한 MP3를 반환한다", async () => {
    const videoPath = await writeToTmp(await makeTestVideo(3, "mp4"), "mp4");
    try {
      const audio = await extractAudio(videoPath);
      expect(audio.byteLength).toBeGreaterThan(100);
      const duration = await getDuration(audio, "mp3");
      expect(duration).toBeCloseTo(3, 0);
    } finally {
      await unlink(videoPath).catch(() => {});
    }
  }, 30_000);

  it("MOV 비디오에서도 오디오를 추출한다", async () => {
    const videoPath = await writeToTmp(await makeTestVideo(3, "mov"), "mov");
    try {
      const audio = await extractAudio(videoPath);
      expect(audio.byteLength).toBeGreaterThan(100);
      expect(await hasAudioStream(audio, "mp3")).toBe(true);
    } finally {
      await unlink(videoPath).catch(() => {});
    }
  }, 30_000);
});

// ─── muxVideoWithAudio ────────────────────────────────────────────────────────

describe("muxVideoWithAudio", () => {
  it("비디오와 오디오를 합치면 유효한 영상을 반환한다", async () => {
    const videoPath = await writeToTmp(await makeTestVideo(5, "mp4"), "mp4");
    try {
      const result = await muxVideoWithAudio(videoPath, await makeTestAudio(5), "video/mp4");
      expect(result.byteLength).toBeGreaterThan(1000);
      expect(await getDuration(result, "mp4")).toBeCloseTo(5, 0);
    } finally {
      await unlink(videoPath).catch(() => {});
    }
  }, 60_000);

  it("더빙 오디오가 비디오보다 짧아도 비디오 길이에 맞춰 출력한다", async () => {
    const videoPath = await writeToTmp(await makeTestVideo(10, "mp4"), "mp4");
    try {
      const result = await muxVideoWithAudio(videoPath, await makeTestAudio(8), "video/mp4");
      expect(result.byteLength).toBeGreaterThan(1000);
      expect(await getDuration(result, "mp4")).toBeCloseTo(10, 0);
      expect(await hasAudioStream(result, "mp4")).toBe(true);
    } finally {
      await unlink(videoPath).catch(() => {});
    }
  }, 60_000);

  it("더빙 오디오가 비디오보다 길어도 비디오 길이에 맞춰 출력한다", async () => {
    const videoPath = await writeToTmp(await makeTestVideo(5, "mp4"), "mp4");
    try {
      const result = await muxVideoWithAudio(videoPath, await makeTestAudio(7), "video/mp4");
      expect(result.byteLength).toBeGreaterThan(1000);
      expect(await getDuration(result, "mp4")).toBeCloseTo(5, 0);
    } finally {
      await unlink(videoPath).catch(() => {});
    }
  }, 60_000);

  it("결과 영상에 오디오 스트림이 포함된다", async () => {
    const videoPath = await writeToTmp(await makeTestVideo(5, "mp4"), "mp4");
    try {
      const result = await muxVideoWithAudio(videoPath, await makeTestAudio(5), "video/mp4");
      expect(await hasAudioStream(result, "mp4")).toBe(true);
    } finally {
      await unlink(videoPath).catch(() => {});
    }
  }, 60_000);

  it("MOV 비디오와 오디오를 합쳐도 유효한 영상을 반환한다", async () => {
    const videoPath = await writeToTmp(await makeTestVideo(5, "mov"), "mov");
    try {
      const result = await muxVideoWithAudio(videoPath, await makeTestAudio(5), "video/quicktime");
      expect(result.byteLength).toBeGreaterThan(1000);
      expect(await getDuration(result, "mp4")).toBeCloseTo(5, 0);
    } finally {
      await unlink(videoPath).catch(() => {});
    }
  }, 60_000);

  it("WebM 비디오와 오디오를 합치면 유효한 WebM을 반환한다", async () => {
    const videoPath = await writeToTmp(await makeTestVideoWebM(5), "webm");
    try {
      const result = await muxVideoWithAudio(videoPath, await makeTestAudio(5), "video/webm");
      expect(result.byteLength).toBeGreaterThan(1000);
      expect(await getDuration(result, "webm")).toBeCloseTo(5, 0);
      expect(await hasAudioStream(result, "webm")).toBe(true);
    } finally {
      await unlink(videoPath).catch(() => {});
    }
  }, 60_000);

  it("audioBuffer가 null이면 원본 영상 오디오를 유지한다", async () => {
    const videoPath = await writeToTmp(await makeTestVideo(5, "mp4"), "mp4");
    try {
      const result = await muxVideoWithAudio(videoPath, null, "video/mp4");
      expect(result.byteLength).toBeGreaterThan(1000);
      expect(await getDuration(result, "mp4")).toBeCloseTo(5, 0);
      expect(await hasAudioStream(result, "mp4")).toBe(true);
    } finally {
      await unlink(videoPath).catch(() => {});
    }
  }, 60_000);

  it("srtPath를 전달하면 자막이 소각된 유효한 영상을 반환한다", async () => {
    const videoPath = await writeToTmp(await makeTestVideo(5, "mp4"), "mp4");
    const srtContent = "1\n00:00:00,000 --> 00:00:03,000\nTest Subtitle\n\n";
    const srtPath = join(tmpdir(), `${randomUUID()}.srt`);
    await writeFile(srtPath, srtContent);
    try {
      const result = await muxVideoWithAudio(videoPath, await makeTestAudio(5), "video/mp4", undefined, srtPath);
      expect(result.byteLength).toBeGreaterThan(1000);
      expect(await getDuration(result, "mp4")).toBeCloseTo(5, 0);
      expect(await hasAudioStream(result, "mp4")).toBe(true);
    } finally {
      await unlink(videoPath).catch(() => {});
      await unlink(srtPath).catch(() => {});
    }
  }, 60_000);

  it("audioBuffer null + srtPath 조합으로 원본 오디오 유지하며 자막을 소각한다", async () => {
    const videoPath = await writeToTmp(await makeTestVideo(5, "mp4"), "mp4");
    const srtContent = "1\n00:00:00,000 --> 00:00:03,000\nCaption Only\n\n";
    const srtPath = join(tmpdir(), `${randomUUID()}.srt`);
    await writeFile(srtPath, srtContent);
    try {
      const result = await muxVideoWithAudio(videoPath, null, "video/mp4", undefined, srtPath);
      expect(result.byteLength).toBeGreaterThan(1000);
      expect(await getDuration(result, "mp4")).toBeCloseTo(5, 0);
      expect(await hasAudioStream(result, "mp4")).toBe(true);
    } finally {
      await unlink(videoPath).catch(() => {});
      await unlink(srtPath).catch(() => {});
    }
  }, 60_000);
});
