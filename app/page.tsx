"use client";

import { useRef, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { cropFileOnClient, formatTime, MAX_CROP_DURATION } from "@/lib/ffmpeg-client";

const LANGUAGES = [
  { code: "ko", label: "한국어" },
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
  { code: "zh", label: "中文" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "pt", label: "Português" },
];

const PIPELINE_STEPS = [
  { key: "transcribing", label: "음성 전사 (STT)" },
  { key: "translating", label: "텍스트 번역" },
  { key: "synthesizing", label: "음성 합성 (TTS)" },
] as const;

type PipelineKey = (typeof PIPELINE_STEPS)[number]["key"];
type PageStep = "idle" | "ready" | "cropping" | "processing" | "done" | "error";


export default function Home() {
  const { data: session } = useSession();
  const router = useRouter();
  const [pageStep, setPageStep] = useState<PageStep>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [targetLang, setTargetLang] = useState("en");
  const [isDragging, setIsDragging] = useState(false);
  const [activeStep, setActiveStep] = useState<PipelineKey | null>(null);
  const [doneSteps, setDoneSteps] = useState<Set<PipelineKey>>(new Set());
  const [resultId, setResultId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fileDuration, setFileDuration] = useState<number | null>(null);
  const [cropStart, setCropStart] = useState(0);
  const [cropEnd, setCropEnd] = useState<number | null>(null);
  const [showLoginPopup, setShowLoginPopup] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function requireAuth(): boolean {
    if (!session) {
      setShowLoginPopup(true);
      return false;
    }
    return true;
  }

  function handleFile(f: File) {
    if (!requireAuth()) return;
    setFile(f);
    setCropStart(0);
    setCropEnd(null);
    setFileDuration(null);

    const url = URL.createObjectURL(f);
    const media = f.type.startsWith("video/")
      ? document.createElement("video")
      : document.createElement("audio");
    media.src = url;
    media.onloadedmetadata = () => {
      setFileDuration(media.duration);
      setCropEnd(Math.min(media.duration, MAX_CROP_DURATION));
      URL.revokeObjectURL(url);
    };

    setPageStep("ready");
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  }

  async function handleStart() {
    if (!file || !requireAuth()) return;

    setDoneSteps(new Set());
    setResultId(null);
    setErrorMessage(null);

    const effectiveEnd = cropEnd ?? fileDuration ?? 0;
    const needsCrop = fileDuration !== null && (cropStart > 0 || effectiveEnd < fileDuration);

    // 크롭 필요 시: FFmpeg WASM으로 클라이언트에서 크롭 (stream copy, 무손실)
    let fileToSend = file;
    if (needsCrop) {
      setPageStep("cropping");
      try {
        fileToSend = await cropFileOnClient(file, cropStart, effectiveEnd);
      } catch (err) {
        console.error("[crop]", err);
        setErrorMessage(err instanceof Error ? err.message : "파일 크롭 중 오류가 발생했습니다.");
        setPageStep("error");
        return;
      }
    }

    setPageStep("processing");

    // Vercel Blob에 먼저 업로드 (Vercel Serverless 4.5MB 제한 우회)
    let blobUrl: string;
    try {
      const ext = fileToSend.name.includes(".") ? fileToSend.name.split(".").pop() : "";
      const uniqueName = `${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;
      const blob = await upload(uniqueName, fileToSend, {
        access: "public",
        handleUploadUrl: "/api/upload",
      });
      blobUrl = blob.url;
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "파일 업로드 중 오류가 발생했습니다.");
      setPageStep("error");
      return;
    }

    setActiveStep("transcribing");

    const res = await fetch("/api/dub", {
      method: "POST",
      headers: {
        "x-target-lang": targetLang,
        "x-file-type": fileToSend.type,
        "x-file-name": encodeURIComponent(fileToSend.name),
        "x-blob-url": blobUrl,
        "x-original-file-type": file.type,
        "x-original-file-name": encodeURIComponent(file.name),
      },
    });
    if (!res.ok || !res.body) {
      setErrorMessage("서버 오류가 발생했습니다.");
      setPageStep("error");
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        const dataLine = block.split("\n").find((l) => l.startsWith("data: "));
        if (!dataLine) continue;

        let event: { step: string; resultId?: string; message?: string };
        try {
          event = JSON.parse(dataLine.slice(6));
        } catch {
          continue;
        }

        if (event.step === "transcribing") {
          setActiveStep("transcribing");
        } else if (event.step === "translating") {
          setDoneSteps((prev) => new Set([...prev, "transcribing"]));
          setActiveStep("translating");
        } else if (event.step === "synthesizing") {
          setDoneSteps((prev) => new Set([...prev, "transcribing", "translating"]));
          setActiveStep("synthesizing");
        } else if (event.step === "done" && event.resultId) {
          setDoneSteps(new Set(PIPELINE_STEPS.map((s) => s.key)));
          setActiveStep(null);
          setResultId(event.resultId);
          setPageStep("done");
        } else if (event.step === "error") {
          setErrorMessage(event.message ?? "알 수 없는 오류");
          setPageStep("error");
        }
      }
    }
  }

  function handleReset() {
    setFile(null);
    setPageStep("idle");
    setActiveStep(null);
    setDoneSteps(new Set());
    setResultId(null);
    setErrorMessage(null);
    setFileDuration(null);
    setCropStart(0);
    setCropEnd(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const audioUrl = resultId ? `/api/dub?resultId=${resultId}` : null;

  return (
    <div className="min-h-screen bg-white text-zinc-900 font-sans antialiased">
      {/* Login Required Popup */}
      {showLoginPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-8 mx-4 max-w-sm w-full text-center">
            <p className="text-base font-semibold text-zinc-900 mb-2">로그인이 필요합니다</p>
            <p className="text-sm text-zinc-500 mb-6">이 기능을 사용하려면 먼저 로그인해 주세요.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowLoginPopup(false)}
                className="flex-1 py-2.5 rounded-xl border border-zinc-200 text-sm text-zinc-600 hover:border-zinc-400 transition-colors"
              >
                취소
              </button>
              <button
                onClick={() => router.push("/login")}
                className="flex-1 py-2.5 rounded-xl bg-zinc-900 text-sm text-white font-semibold hover:bg-zinc-700 transition-colors"
              >
                로그인하기
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Header */}
      <header className="border-b border-zinc-100 px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <span className="text-sm font-semibold tracking-tight text-zinc-900">
            AOTO DUB
          </span>
          <div className="flex items-center gap-4">
            {session?.user?.isAdmin && (
              <a
                href="/admin"
                className="text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
              >
                관리자
              </a>
            )}
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="text-xs text-zinc-400 hover:text-zinc-600 transition-colors cursor-pointer"
            >
              로그아웃
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-2xl mx-auto px-6 py-20">
        {/* Hero */}
        <div className="mb-16">
          <h1 className="text-4xl font-bold tracking-tight text-zinc-900 leading-tight mb-4">
            언어의 장벽은 이제 그만
            <br />
            자동 더빙 서비스 Auto Dub
          </h1>
          <p className="text-zinc-500 text-base leading-relaxed">
            더빙을 원하는 오디오 또는 비디오 파일을 업로드하세요.
            <br />
            무료버전인 만큼 최대 길이는 1분으로 부탁드려요 (⁎⁍̴̛ ₃ ⁍̴̛⁎)!!
          </p>
        </div>

        {/* Upload Zone */}
        {pageStep !== "done" && (
          <div className="mb-8">
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/mp4,video/quicktime"
              className="hidden"
              onChange={handleFileChange}
              id="file-input"
            />
            <label
              htmlFor="file-input"
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={[
                "flex flex-col items-center justify-center gap-3 w-full rounded-2xl border-2 border-dashed cursor-pointer transition-all duration-150 py-14 px-8 text-center",
                isDragging
                  ? "border-zinc-400 bg-zinc-50"
                  : file
                    ? "border-zinc-300 bg-zinc-50"
                    : "border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50",
              ].join(" ")}
            >
              {file ? (
                <>
                  <div className="w-10 h-10 rounded-xl bg-zinc-900 flex items-center justify-center">
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="white"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M9 18V5l12-2v13" />
                      <circle cx="6" cy="18" r="3" />
                      <circle cx="18" cy="16" r="3" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-zinc-900">
                      {file.name}
                    </p>
                    <p className="text-xs text-zinc-400 mt-1">
                      {(file.size / 1024 / 1024).toFixed(1)} MB
                    </p>
                  </div>
                  {pageStep !== "processing" && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        handleReset();
                      }}
                      className="text-xs text-zinc-400 hover:text-zinc-600 underline underline-offset-2 transition-colors"
                    >
                      다시 선택
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div className="w-10 h-10 rounded-xl bg-zinc-100 flex items-center justify-center">
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#71717a"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-zinc-700">
                      파일을 여기에 드래그하거나 클릭해서 선택
                    </p>
                    <p className="text-xs text-zinc-400 mt-1">
                      MP3, MP4, WAV, MOV 등 오디오·비디오 파일
                    </p>
                  </div>
                </>
              )}
            </label>
          </div>
        )}

        {/* Crop Selector */}
        {pageStep === "ready" && fileDuration !== null && cropEnd !== null && (
          <div className="mb-6 rounded-2xl border border-zinc-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-widest">
                구간 선택
              </label>
              <span className="text-xs font-mono text-zinc-700">
                {formatTime(cropStart)} – {formatTime(cropEnd)}
                <span className="text-zinc-400 ml-1">({formatTime(cropEnd - cropStart)})</span>
              </span>
            </div>

            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs text-zinc-400 mb-1.5">
                  <span>시작</span>
                  <span className="font-mono text-zinc-600">{formatTime(cropStart)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.floor(fileDuration)}
                  step={1}
                  value={cropStart}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setCropStart(val);
                    if (val >= cropEnd) setCropEnd(Math.min(val + 1, Math.floor(fileDuration)));
                    else if (cropEnd - val > MAX_CROP_DURATION) setCropEnd(val + MAX_CROP_DURATION);
                  }}
                  className="w-full accent-zinc-900"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs text-zinc-400 mb-1.5">
                  <span>끝</span>
                  <span className="font-mono text-zinc-600">{formatTime(cropEnd)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.floor(fileDuration)}
                  step={1}
                  value={cropEnd}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setCropEnd(val);
                    if (val <= cropStart) setCropStart(Math.max(val - 1, 0));
                    else if (val - cropStart > MAX_CROP_DURATION) setCropStart(val - MAX_CROP_DURATION);
                  }}
                  className="w-full accent-zinc-900"
                />
              </div>
            </div>

            <div className="flex justify-between mt-3 text-xs text-zinc-400">
              <span>0:00</span>
              <span>{formatTime(Math.floor(fileDuration))}</span>
            </div>
          </div>
        )}

        {/* Language Selector + CTA */}
        {(pageStep === "ready" || pageStep === "cropping" || pageStep === "processing") && (
          <div className="space-y-4 mb-8">
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-2 uppercase tracking-widest">
                타겟 언어
              </label>
              <div className="grid grid-cols-4 gap-2">
                {LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => setTargetLang(lang.code)}
                    disabled={pageStep !== "ready"}
                    className={[
                      "py-2.5 rounded-xl text-sm font-medium transition-all duration-100 border",
                      targetLang === lang.code
                        ? "bg-zinc-900 text-white border-zinc-900"
                        : "bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400 hover:text-zinc-900",
                      pageStep !== "ready"
                        ? "opacity-50 cursor-not-allowed"
                        : "",
                    ].join(" ")}
                  >
                    {lang.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleStart}
              disabled={pageStep !== "ready"}
              className={[
                "w-full py-4 rounded-2xl text-sm font-semibold transition-all duration-150",
                pageStep !== "ready"
                  ? "bg-zinc-200 text-zinc-400 cursor-not-allowed"
                  : "bg-zinc-900 text-white hover:bg-zinc-700 active:scale-[0.99]",
              ].join(" ")}
            >
              {pageStep === "cropping" ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                  </svg>
                  파일 크롭 중...
                </span>
              ) : pageStep === "processing" ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                  </svg>
                  더빙 중...
                </span>
              ) : (
                "더빙 시작하기"
              )}
            </button>
          </div>
        )}

        {/* Cropping Progress */}
        {pageStep === "cropping" && (
          <div className="rounded-2xl border border-zinc-100 bg-zinc-50 p-6 mb-8">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-widest mb-3">
              파일 크롭 중
            </p>
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 rounded-full border-2 border-zinc-600 flex-shrink-0" />
              <span className="text-sm text-zinc-700 font-medium">
                {formatTime(cropStart)} – {formatTime(cropEnd ?? 0)} 구간 추출 중...
              </span>
            </div>
          </div>
        )}

        {/* Processing Progress */}
        {pageStep === "processing" && (
          <div className="rounded-2xl border border-zinc-100 bg-zinc-50 p-6 space-y-4 mb-8">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-widest">
              진행 상황
            </p>
            {PIPELINE_STEPS.map((s) => {
              const isDone = doneSteps.has(s.key);
              const isActive = activeStep === s.key;
              return (
                <div key={s.key} className="flex items-center gap-3">
                  <div
                    className={[
                      "w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 transition-colors",
                      isDone
                        ? "bg-zinc-900"
                        : isActive
                          ? "border-2 border-zinc-600"
                          : "border-2 border-zinc-200",
                    ].join(" ")}
                  >
                    {isDone && (
                      <svg
                        width="8"
                        height="8"
                        viewBox="0 0 12 12"
                        fill="none"
                        stroke="white"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="2 6 5 9 10 3" />
                      </svg>
                    )}
                  </div>
                  <span
                    className={
                      isDone
                        ? "text-sm text-zinc-900 font-medium"
                        : isActive
                          ? "text-sm text-zinc-700 font-medium"
                          : "text-sm text-zinc-300"
                    }
                  >
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Error */}
        {pageStep === "error" && (
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6 mb-8">
            <p className="text-sm font-medium text-zinc-900 mb-1">오류 발생</p>
            <p className="text-xs text-zinc-500 mb-4">{errorMessage}</p>
            <button
              onClick={handleReset}
              className="text-xs text-zinc-600 underline underline-offset-2 hover:text-zinc-900 transition-colors"
            >
              다시 시도
            </button>
          </div>
        )}

        {/* Result */}
        {pageStep === "done" && audioUrl && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-zinc-200 p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-8 h-8 rounded-full bg-zinc-900 flex items-center justify-center">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="white"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="2 6 5 9 10 3" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-zinc-900">
                    더빙 완료
                  </p>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    {LANGUAGES.find((l) => l.code === targetLang)?.label}{" "}
                    버전이 준비되었어요
                  </p>
                </div>
              </div>

              {/* Native Audio/Video Player */}
              <div className="bg-zinc-50 rounded-xl p-4 mb-4">
                <p className="text-xs text-zinc-400 mb-3">
                  {file?.type.startsWith("video/") ? "미리 보기" : "미리 듣기"}
                </p>
                {file?.type.startsWith("video/") ? (
                  <video
                    controls
                    src={audioUrl}
                    className="w-full rounded-lg"
                    playsInline
                  >
                    <source src={audioUrl} type={file.type} />
                  </video>
                ) : (
                  <audio
                    controls
                    src={audioUrl}
                    className="w-full h-8 accent-zinc-900"
                  />
                )}
              </div>

              <a
                href={audioUrl}
                download={
                  file?.type === "video/webm"
                    ? "dubbed.webm"
                    : file?.type.startsWith("video/")
                      ? "dubbed.mp4"
                      : "dubbed.mp3"
                }
                className="w-full py-3 rounded-xl border border-zinc-900 text-sm font-semibold text-zinc-900 hover:bg-zinc-900 hover:text-white transition-all duration-150 flex items-center justify-center gap-2"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                결과 파일 다운로드
              </a>
            </div>

            <button
              onClick={handleReset}
              className="w-full py-3 text-sm text-zinc-400 hover:text-zinc-600 transition-colors"
            >
              새 파일 더빙하기
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
