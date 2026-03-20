# Auto Dub

오디오/비디오 파일을 업로드하면 지정한 언어로 자동 더빙된 결과물을 반환하는 음성 더빙 서비스입니다.

## 기능

- 오디오(MP3, M4A, WAV, FLAC) 및 비디오(MP4, MOV, AVI, MKV, WebM) 파일 지원
- 파일 업로드 후 구간 슬라이더로 시작/끝 지점 선택 (최대 60초)
- ElevenLabs API를 활용한 전사 → 번역 → 음성 합성 파이프라인
- 더빙된 오디오/비디오 재생 및 다운로드
- Google OAuth 로그인 + 화이트리스트 기반 접근 제어

## 개발 서버 실행

```bash
npm install
npm run dev
```

[http://localhost:3000](http://localhost:3000)에서 확인할 수 있습니다.

## 환경 변수

`.env.local` 파일을 생성하고 아래 값을 채워넣으세요:

```
ELEVENLABS_API_KEY=         # ElevenLabs API 키
AUTH_SECRET=                # NextAuth.js 시크릿 (openssl rand -base64 32)
AUTH_GOOGLE_ID=             # Google OAuth 클라이언트 ID
AUTH_GOOGLE_SECRET=         # Google OAuth 클라이언트 시크릿
TURSO_DATABASE_URL=         # Turso DB URL
TURSO_AUTH_TOKEN=           # Turso 인증 토큰
```

## 명령어

```bash
npm run dev           # 개발 서버 실행
npm run build         # 프로덕션 빌드
npm run start         # 프로덕션 서버 실행
npm run lint          # ESLint 실행
npm run test          # 테스트 실행
npm run test:watch    # TDD watch 모드
npm run test:coverage # 커버리지 리포트
```

## 기술 스택

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS v4**
- **ElevenLabs API** — STT / 번역 / TTS
- **fluent-ffmpeg + ffmpeg-static** — 서버 사이드 비디오 크롭 및 오디오 먹싱
- **@ffmpeg/ffmpeg (WASM)** — 클라이언트 사이드 오디오 크롭
- **NextAuth.js v5** — Google OAuth 인증
- **Turso (libSQL)** — 화이트리스트 DB
- **Vitest** — 단위 테스트
