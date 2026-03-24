const MAX_CROP_DURATION = 60;

// FFmpeg WASM 싱글턴
let ffmpegInstance: import("@ffmpeg/ffmpeg").FFmpeg | null = null;
let ffmpegLoadPromise: Promise<import("@ffmpeg/ffmpeg").FFmpeg> | null = null;

export async function loadFFmpeg() {
  if (ffmpegInstance) return ffmpegInstance;
  if (ffmpegLoadPromise) return ffmpegLoadPromise;

  ffmpegLoadPromise = (async () => {
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const { toBlobURL } = await import("@ffmpeg/util");
    const ff = new FFmpeg();
    await ff.load({
      coreURL: await toBlobURL("/ffmpeg/ffmpeg-core.js", "text/javascript"),
      wasmURL: await toBlobURL("/ffmpeg/ffmpeg-core.wasm", "application/wasm"),
    });
    ffmpegInstance = ff;
    return ff;
  })();

  return ffmpegLoadPromise;
}

export async function cropFileOnClient(
  file: File,
  startSec: number,
  endSec: number
): Promise<File> {
  const durationSec = endSec - startSec;
  const { fetchFile } = await import("@ffmpeg/util");
  const ff = await loadFFmpeg();
  const MIME_EXT: Record<string, string> = {
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/x-wav": "wav",
    "audio/x-flac": "flac",
    "video/quicktime": "mov",
    "video/x-msvideo": "avi",
    "video/x-matroska": "mkv",
  };
  const sub = file.type.split("/")[1] ?? "";
  const ext = MIME_EXT[file.type] ?? (sub.startsWith("x-") ? sub.slice(2) : sub);
  const input = `input.${ext}`;
  const output = `output.${ext}`;

  await ff.writeFile(input, await fetchFile(file));

  const args = [
    "-ss", String(startSec),
    "-i", input,
    "-t", String(durationSec),
    "-c", "copy",
    "-y", output,
  ];

  const exitCode = await ff.exec(args);
  if (exitCode !== 0) throw new Error(`FFmpeg 종료 코드: ${exitCode} (파일 형식: ${file.type})`);
  const data = await ff.readFile(output) as Uint8Array;
  // deleteFile 전에 복사 — readFile은 WASM FS 메모리의 view를 반환하므로
  // deleteFile 이후 참조하면 해제된 메모리를 읽게 된다
  const copy = data.slice();
  await ff.deleteFile(input);
  await ff.deleteFile(output);

  return new File([copy.buffer], file.name, { type: file.type });
}

export { MAX_CROP_DURATION };

export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
