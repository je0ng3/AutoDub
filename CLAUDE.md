# CLAUDE.md

이 파일은 Claude Code가 이 저장소에서 작업할 때 참고하는 가이드입니다.

## 프로젝트 개요

**auto-dub** — 오디오/비디오 파일을 업로드하면 지정한 타겟 언어로 자동 더빙된 결과물을 제공하는 음성 더빙 서비스.

- **입력**: 오디오/비디오 파일 + 타겟 언어 선택
- **출력**: 타겟 언어로 더빙된 오디오/비디오 파일 (재생 및 다운로드)

## 명령어

```bash
npm run dev           # 개발 서버 실행 (http://localhost:3000)
npm run build         # 프로덕션 빌드
npm run start         # 프로덕션 서버 실행
npm run lint          # ESLint 실행
npm run test          # 테스트 실행
npm run test:watch    # TDD watch 모드
npm run test:coverage # 커버리지 리포트
```

## 기술 스택

- **Next.js 16** (App Router)
- **React 19**
- **TypeScript** (strict 모드, 경로 별칭 `@/*`는 저장소 루트에 매핑)
- **Tailwind CSS v4** (`@tailwindcss/postcss`로 설정, CSS에서 `@import "tailwindcss"`로 임포트)
- **ElevenLabs API** — 음성 전사(STT), 번역, 음성 합성(TTS)
- **NextAuth.js v5 (beta)** — Google OAuth 인증
- **Vitest + Testing Library** — 단위/컴포넌트 테스트
- **Turso (libSQL)** — 데이터베이스 (회원 화이트리스트 관리)
- **fluent-ffmpeg + ffmpeg-static** — 서버 사이드 오디오 추출 및 오디오 먹싱
- **@ffmpeg/ffmpeg (WASM)** — 클라이언트 사이드 오디오/비디오 크롭
- **Vercel** — 배포

## 더빙 파이프라인

0. **구간 크롭** — 사용자가 슬라이더로 시작/끝 지점 선택 (최대 60초)
   - 오디오/비디오 모두 클라이언트에서 FFmpeg WASM으로 크롭 (`-c copy`, stream copy 무손실)
1. **전사** — 업로드된 파일에서 음성 추출 → ElevenLabs STT API로 텍스트 전사
2. **번역** — 전사 텍스트를 ElevenLabs API로 타겟 언어 번역
3. **합성** — 번역 텍스트를 ElevenLabs TTS API로 타겟 언어 음성 생성
4. **먹싱** — 비디오의 경우 더빙 오디오를 원본 영상에 합성 (비디오 길이 기준)
5. **결과 제공** — 더빙된 오디오/비디오 재생 및 다운로드

## 인증 및 접근 제어

- **Google OAuth** (NextAuth.js) 로그인 전용
- **화이트리스트 기반 접근 제어** — Turso DB에 등록된 이메일만 서비스 이용 가능
- 미승인 사용자는 로그인 후 접근 거부 처리

## 아키텍처

애플리케이션 코드는 `app/`에 위치합니다:

- `app/layout.tsx` — 루트 레이아웃; Geist Sans + Geist Mono 폰트 및 전역 CSS 설정
- `app/providers.tsx` — 클라이언트 사이드 `SessionProvider` 래퍼 (useSession 컨텍스트 제공)
- `app/page.tsx` — 홈 페이지; 파일 업로드, 구간 슬라이더, 더빙 진행 상태 UI; 미인증 사용자 로그인 팝업
- `app/globals.css` — 전역 스타일; CSS 커스텀 속성 및 Tailwind 테마 토큰
- `app/api/dub/route.ts` — 더빙 파이프라인 API 라우트 (raw body + 헤더 방식)
- `app/api/auth/` — NextAuth.js 핸들러

`lib/` 디렉토리:
- `lib/elevenlabs.ts` — ElevenLabs 더빙 API 클라이언트
- `lib/ffmpeg.ts` — 서버 사이드 오디오 추출(`extractAudio`) 및 오디오 먹싱(`muxVideoWithAudio`)
- `lib/ffmpeg.test.ts` — FFmpeg 유틸리티 단위 테스트
- `lib/ffmpeg-client.ts` — 클라이언트 사이드 FFmpeg WASM 유틸리티 (`loadFFmpeg`, `cropFileOnClient`, `formatTime`)
- `lib/db.ts` — Turso DB 클라이언트 (화이트리스트 관리)

설정 파일:
- `next.config.ts` — Next.js 설정
- `scripts/download-ffmpeg.js` — FFmpeg WASM 파일(`public/ffmpeg/`) 다운로드 스크립트; `npm run build` 전 자동 실행 (`prebuild`)


## 개발 규칙

### 코드 작성 규칙
- **절대 모킹하지 않기**: 실제 동작하는 코드만 작성
- **타입 안정성**: TypeScript strict 모드 준수
- **테스트 우선**: 테스트 커버리지 100% 목표    

## 개발 워크플로우 (증강 코딩 + TDD)

### 켄트 벡의 증강 코딩
- **증강 코딩 vs 바이브 코딩**: 코드 품질, 테스트, 단순성을 중시하되 AI와 협업
- **중간 결과 관찰**: AI가 반복 동작, 요청하지 않은 기능 구현, 테스트 삭제 등의 신호를 보이면 즉시 개입
- **설계 주도권 유지**: AI가 너무 앞서가지 않도록 개발자가 설계 방향 제시

### TDD 워크플로우
1. 실패하는 테스트 먼저 작성
2. 테스트를 통과하는 최소 코드 작성
3. 코드 품질 개선

