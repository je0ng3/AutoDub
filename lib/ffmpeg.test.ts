// @vitest-environment node
import { execFile } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { readFile, writeFile, unlink } from "fs/promises";
import { isVideoFile, cropAndPrepareVideo, muxVideoWithAudio, detectSpeechSegments } from "./ffmpeg";

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

/**
 * 발화-묵음 패턴을 가진 오디오 생성.
 * tone은 440Hz sine, silence는 묵음.
 * 예) [{type:"tone",sec:2},{type:"silence",sec:1},{type:"tone",sec:2}]
 */
async function makeAudioWithGaps(
  patterns: Array<{ type: "tone" | "silence"; sec: number }>
): Promise<Buffer> {
  // 세그먼트별 파일 생성 후 concat
  const segPaths: string[] = [];
  for (const p of patterns) {
    const segPath = join(tmpdir(), `${randomUUID()}.mp3`);
    const source = p.type === "tone"
      ? `sine=frequency=440:duration=${p.sec}`
      : `anullsrc=r=44100:cl=mono`;
    await execFileAsync(ffmpegBin, [
      "-f", "lavfi", "-i", source,
      "-c:a", "libmp3lame",
      "-t", String(p.sec),
      "-y", segPath,
    ]);
    segPaths.push(segPath);
  }

  const outputPath = join(tmpdir(), `${randomUUID()}.mp3`);
  const inputs = segPaths.flatMap((p) => ["-i", p]);
  const filterInputs = segPaths.map((_, i) => `[${i}:a]`).join("");
  await execFileAsync(ffmpegBin, [
    ...inputs,
    "-filter_complex", `${filterInputs}concat=n=${segPaths.length}:v=0:a=1[out]`,
    "-map", "[out]",
    "-c:a", "libmp3lame",
    "-y", outputPath,
  ]);

  await Promise.all(segPaths.map((p) => unlink(p).catch(() => {})));
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

  it("audio/mpeg는 video로 판별하지 않는다", () => {
    const file = new File([], "test.mp3", { type: "audio/mpeg" });
    expect(isVideoFile(file)).toBe(false);
  });
});

// ─── cropAndPrepareVideo ──────────────────────────────────────────────────────

describe("cropAndPrepareVideo", () => {
  it("MP4를 0초부터 5초로 크롭하면 유효한 MP4를 반환한다", async () => {
    const input = await makeTestVideo(10, "mp4");
    const result = await cropAndPrepareVideo(input, "video/mp4", 0, 5);

    expect(result.byteLength).toBeGreaterThan(1000);
    const duration = await getDuration(result, "mp4");
    expect(duration).toBeCloseTo(5, 0);
  }, 60_000);

  it("MOV를 0초부터 5초로 크롭하면 유효한 MP4를 반환한다", async () => {
    const input = await makeTestVideo(10, "mov");
    const result = await cropAndPrepareVideo(input, "video/quicktime", 0, 5);

    expect(result.byteLength).toBeGreaterThan(1000);
    const duration = await getDuration(result, "mp4");
    expect(duration).toBeCloseTo(5, 0);
  }, 60_000);

  it("중간 구간(3초~7초)을 크롭하면 약 4초짜리 MP4를 반환한다", async () => {
    const input = await makeTestVideo(10, "mp4");
    const result = await cropAndPrepareVideo(input, "video/mp4", 3, 4);

    expect(result.byteLength).toBeGreaterThan(1000);
    const duration = await getDuration(result, "mp4");
    // stream copy는 키프레임까지 포함하므로 ±1초 허용
    expect(duration).toBeGreaterThanOrEqual(3.5);
    expect(duration).toBeLessThan(6);
  }, 60_000);

  it("30초짜리 비디오의 중간 구간(10초~25초)을 크롭하면 약 15초짜리 MP4를 반환한다", async () => {
    const input = await makeTestVideo(30, "mp4");
    const result = await cropAndPrepareVideo(input, "video/mp4", 10, 15);

    expect(result.byteLength).toBeGreaterThan(1000);
    const duration = await getDuration(result, "mp4");
    expect(duration).toBeGreaterThanOrEqual(14);
    expect(duration).toBeLessThan(17);
  }, 90_000);

  it("durationSec 없이 호출하면 startSec 이후 전체를 반환한다", async () => {
    const input = await makeTestVideo(10, "mp4");
    const result = await cropAndPrepareVideo(input, "video/mp4", 5);

    expect(result.byteLength).toBeGreaterThan(1000);
    const duration = await getDuration(result, "mp4");
    expect(duration).toBeCloseTo(5, 0);
  }, 60_000);

  it("ArrayBuffer→File→file.arrayBuffer() 라운드트립 후에도 cropAndPrepareVideo가 정상 동작한다", async () => {
    const originalBuffer = await makeTestVideo(10, "mov");

    // route.ts의 Buffer 전달 흐름 시뮬레이션
    const arrayBuffer = originalBuffer.buffer.slice(
      originalBuffer.byteOffset,
      originalBuffer.byteOffset + originalBuffer.byteLength
    ) as ArrayBuffer;
    const file = new File([arrayBuffer], "test.mov", { type: "video/quicktime" });
    const roundTripped = Buffer.from(new Uint8Array(await file.arrayBuffer()));

    // 데이터 무결성 확인
    expect(roundTripped.byteLength).toBe(originalBuffer.byteLength);
    expect(roundTripped.equals(originalBuffer)).toBe(true);

    // 라운드트립된 버퍼로 크롭 실행
    const result = await cropAndPrepareVideo(roundTripped, "video/quicktime", 0, 5);
    expect(result.byteLength).toBeGreaterThan(1000);
    const duration = await getDuration(result, "mp4");
    expect(duration).toBeCloseTo(5, 0);
  }, 60_000);
});

// ─── detectSpeechSegments ─────────────────────────────────────────────────────

describe("detectSpeechSegments", () => {
  it("연속 음성에서 1개의 발화 구간을 반환한다", async () => {
    const audio = await makeTestAudio(5);
    const tmpPath = join(tmpdir(), `${randomUUID()}.mp3`);
    await writeFile(tmpPath, audio);
    try {
      const segs = await detectSpeechSegments(tmpPath, 5);
      expect(segs.length).toBeGreaterThanOrEqual(1);
    } finally {
      await unlink(tmpPath).catch(() => {});
    }
  }, 30_000);

  it("중간에 묵음이 있으면 2개의 발화 구간을 반환한다", async () => {
    // 2s 발화 → 1.5s 묵음 → 2s 발화
    const audio = await makeAudioWithGaps([
      { type: "tone", sec: 2 },
      { type: "silence", sec: 1.5 },
      { type: "tone", sec: 2 },
    ]);
    const tmpPath = join(tmpdir(), `${randomUUID()}.mp3`);
    await writeFile(tmpPath, audio);
    try {
      const segs = await detectSpeechSegments(tmpPath, 5.5);
      expect(segs.length).toBe(2);
      // 첫 발화는 0초 근처에서 시작
      expect(segs[0].start).toBeCloseTo(0, 0);
      // 두 번째 발화는 3초 근처에서 시작 (2s + 1.5s 묵음)
      expect(segs[1].start).toBeGreaterThan(2);
    } finally {
      await unlink(tmpPath).catch(() => {});
    }
  }, 30_000);
});

// ─── muxVideoWithAudio ────────────────────────────────────────────────────────

describe("muxVideoWithAudio", () => {
  it("비디오와 오디오를 합치면 유효한 영상을 반환한다", async () => {
    const video = await makeTestVideo(5, "mp4");
    const audio = await makeTestAudio(5);
    const result = await muxVideoWithAudio(video, audio, "video/mp4");

    expect(result.byteLength).toBeGreaterThan(1000);
    const duration = await getDuration(result, "mp4");
    expect(duration).toBeCloseTo(5, 0);
  }, 60_000);

  it("더빙 오디오가 비디오보다 짧으면 발화 구간 싱크로 비디오 길이에 맞춘다", async () => {
    const video = await makeTestVideo(10, "mp4");
    const audio = await makeTestAudio(8);
    const result = await muxVideoWithAudio(video, audio, "video/mp4");

    expect(result.byteLength).toBeGreaterThan(1000);
    const duration = await getDuration(result, "mp4");
    expect(duration).toBeCloseTo(10, 0);
    expect(await hasAudioStream(result, "mp4")).toBe(true);
  }, 60_000);

  it("더빙 오디오가 비디오보다 길면 발화 구간 싱크로 비디오 길이에 맞춘다", async () => {
    const video = await makeTestVideo(5, "mp4");
    const audio = await makeTestAudio(7);
    const result = await muxVideoWithAudio(video, audio, "video/mp4");

    expect(result.byteLength).toBeGreaterThan(1000);
    const duration = await getDuration(result, "mp4");
    expect(duration).toBeCloseTo(5, 0);
  }, 60_000);

  it("결과 영상에 오디오 스트림이 포함된다", async () => {
    const video = await makeTestVideo(5, "mp4");
    const audio = await makeTestAudio(5);
    const result = await muxVideoWithAudio(video, audio, "video/mp4");

    expect(await hasAudioStream(result, "mp4")).toBe(true);
  }, 60_000);

  it("MOV 비디오와 오디오를 합쳐도 유효한 영상을 반환한다", async () => {
    const video = await makeTestVideo(5, "mov");
    const audio = await makeTestAudio(5);
    const result = await muxVideoWithAudio(video, audio, "video/quicktime");

    expect(result.byteLength).toBeGreaterThan(1000);
    const duration = await getDuration(result, "mp4");
    expect(duration).toBeCloseTo(5, 0);
  }, 60_000);

  it("더빙 오디오에 묵음 구간이 있을 때 발화별 싱크를 맞춘다", async () => {
    // 원본: 3s 음성 포함 비디오
    // 더빙: 2s 발화 → 0.5s 묵음 → 2s 발화 (총 4.5s, 원본보다 짧음)
    const video = await makeTestVideo(6, "mp4");
    const audio = await makeAudioWithGaps([
      { type: "tone", sec: 2 },
      { type: "silence", sec: 0.5 },
      { type: "tone", sec: 2 },
    ]);
    const result = await muxVideoWithAudio(video, audio, "video/mp4");

    expect(result.byteLength).toBeGreaterThan(1000);
    const duration = await getDuration(result, "mp4");
    expect(duration).toBeCloseTo(6, 0);
    expect(await hasAudioStream(result, "mp4")).toBe(true);
  }, 60_000);
});
