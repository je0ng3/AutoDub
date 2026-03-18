# Auto-Dub

> 배포 링크: [autodub-peach.vercel.app](https://autodub-peach.vercel.app/)

오디오·비디오 파일을 업로드하면 AI가 원하는 언어로 자동 더빙해주는 서비스입니다.

---

## 서비스 소개 및 주요 기능

**Auto-Dub**은 ElevenLabs AI를 활용해 영상·음성 콘텐츠를 다국어로 자동 더빙합니다.
크리에이터, 교육자, 기업 등 다양한 사용자가 별도의 성우 없이 빠르게 다국어 콘텐츠를 제작할 수 있습니다.

### 주요 기능

| 기능 | 설명 |
|------|------|
| Google 소셜 로그인 | NextAuth.js + Google OAuth를 통한 간편 인증 |
| 이메일 화이트리스트 | 허가된 사용자만 서비스 이용 가능 |
| 자동 더빙 파이프라인 | 오디오/비디오 파일 → 음성 인식 → 번역 → 음성 합성까지 자동 처리 |
| 실시간 진행 상황 표시 | Server-Sent Events(SSE)로 변환 단계(전사 → 번역 → 합성)를 실시간 스트리밍 |
| 비디오 재합성 | 더빙된 음성을 원본 영상에 FFmpeg으로 자동 병합 |
| 결과 미리듣기·다운로드 | 더빙 완료 후 인라인 플레이어로 확인 및 파일 다운로드 |
| 다국어 지원 | 한국어, 영어, 일본어, 중국어, 스페인어, 프랑스어, 독일어, 포르투갈어 |

### 더빙 처리 흐름

```
파일 업로드 → ElevenLabs API 전송
  → [전사] 원본 음성 → 텍스트
  → [번역] 텍스트 → 목표 언어
  → [합성] 번역 텍스트 → 더빙 음성
  → (비디오인 경우) FFmpeg으로 원본 영상 + 더빙 음성 병합
  → 결과 미리듣기 & 다운로드
```

---

## 기술 스택

| 분류 | 기술 |
|------|------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5.9 |
| Styling | Tailwind CSS v4 |
| Auth | NextAuth.js v5 (beta) + Google OAuth |
| AI 더빙 | ElevenLabs API (Auto Dubbing) |
| 영상 처리 | FFmpeg (fluent-ffmpeg + ffmpeg-static) |
| Database | Turso (serverless SQLite, @libsql/client) |
| Streaming | Server-Sent Events (SSE) |
| Testing | Vitest + @testing-library/react |
| Deploy | Vercel |

---

## 로컬 실행 방법

### 1. 사전 준비

- Node.js 18+
- npm

### 2. 저장소 클론 및 의존성 설치

```bash
git clone https://github.com/your-username/auto-dub.git
cd auto-dub
npm install
```

### 3. 환경 변수 설정

`.env.local` 파일을 생성하고 아래 값을 설정합니다:

```env
# NextAuth
NEXTAUTH_SECRET=your_secret
NEXTAUTH_URL=http://localhost:3000

# Google OAuth
AUTH_GOOGLE_ID=your_google_client_id
AUTH_GOOGLE_SECRET=your_google_client_secret

# ElevenLabs
ELEVENLABS_API_KEY=your_elevenlabs_api_key

# Turso
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your_turso_auth_token
```

> **참고**: Google OAuth 클라이언트는 [Google Cloud Console](https://console.cloud.google.com)에서,
> ElevenLabs API 키는 [ElevenLabs](https://elevenlabs.io) 대시보드에서 발급받을 수 있습니다.

### 4. Turso DB 이메일 화이트리스트 설정

Turso DB에 접근 허용할 사용자 이메일을 등록해야 로그인이 가능합니다.

### 5. 개발 서버 실행

[http://localhost:3000](http://localhost:3000)에서 확인할 수 있습니다.

### 스크립트

| 명령어 | 설명 |
|--------|------|
| `npm run dev` | 개발 서버 실행 |
| `npm run build` | 프로덕션 빌드 |
| `npm start` | 프로덕션 서버 실행 |
| `npm run lint` | ESLint 실행 |
| `npm test` | Vitest 테스트 실행 |

---

## 배포된 서비스 URL

**[https://autodub-peach.vercel.app/](https://autodub-peach.vercel.app/)**

- Vercel을 통해 배포되며, `main` 브랜치에 push 시 자동으로 재배포됩니다.
- 서버리스 환경에서 Next.js App Router + API Routes가 동작합니다.

---

## 코딩 에이전트 활용 방법 및 노하우

이 프로젝트는 **Claude Code** AI 코딩 에이전트를 적극 활용하여 개발되었습니다.
아래 세 가지 방법을 조합하면 에이전트와의 협업 품질을 크게 높일 수 있습니다.

---

### 1. `CLAUDE.md` 상세 작성

`CLAUDE.md`는 Claude Code가 저장소에서 작업할 때 가장 먼저 읽는 파일입니다.
여기에 프로젝트 맥락과 규칙을 명시해두면, 매 대화마다 같은 설명을 반복할 필요가 없습니다.

**포함하면 좋은 내용**

| 항목 | 예시 |
|------|------|
| 프로젝트 개요 | 서비스 한 줄 설명, 입력/출력 형식 |
| 주요 기능 파이프라인 | 전사 → 번역 → 합성 → 병합 단계 흐름 |
| 기술 스택 | 프레임워크, 라이브러리, 버전 정보 |
| 아키텍처 | 주요 디렉토리·파일 구조와 역할 |
| 개발 규칙 | 코딩 스타일, 타입 안정성, 테스트 정책 등 |
| 개발 명령어 | `npm run dev`, `npm test` 등 자주 쓰는 명령어 |

**개발 규칙을 명시하는 이유**
Claude Code는 규칙을 명시하지 않으면 매번 다른 패턴으로 코드를 생성할 수 있습니다.
`CLAUDE.md`에 규칙을 적어두면 일관된 코딩 스타일을 유지할 수 있습니다.

---

### 2. `.claude/commands/` 에 자주 쓰는 명령어 저장

`.claude/commands/` 폴더에 마크다운 파일을 만들어두면 `/명령어이름` 으로 언제든 불러 쓸 수 있습니다.
반복적으로 요청하는 작업을 명령어로 미리 정의해두면 매번 긴 지시문을 타이핑할 필요가 없습니다.

**이 프로젝트에 저장된 명령어**

| 명령어 | 파일 | 설명 |
|--------|------|------|
| `/ci_commit` | `.claude/commands/ci_commit.md` | 세션 변경 사항을 atomic한 커밋으로 정리 |
| `/ci_describe_pr` | `.claude/commands/ci_describe_pr.md` | PR 설명 자동 생성 및 GitHub에 업데이트 |

---

### 3. PR 템플릿으로 머지 전 검증

`.github/pull_request_template.md`에 PR 템플릿을 작성해두면
Claude Code가 PR을 생성할 때 자동으로 템플릿을 채우고, 테스트 체크리스트를 항목별로 확인합니다.

**이 프로젝트의 PR 템플릿 구조** (`.github/pull_request_template.md`)

```markdown
## 📝 PR 요약
## ⚒️ 주요 변경 사항
## 🧪 테스트 체크리스트
- [ ] 단위 테스트 통과
- [ ] 더빙 파이프라인 E2E 확인
- [ ] ...
## 💬 추가 사항
```

**활용 방법**

1. Claude Code로 기능 구현 완료 후 `/ci_commit` 명령어 실행으로 커밋
2. 에이전트에 요청하여 PR 생성
3. **테스트 체크리스트를 직접 확인**하며 각 항목 체크
4. 모든 항목 확인 후 머지

> 체크리스트는 에이전트가 자동으로 체크하기보다, **개발자가 직접 눈으로 확인**하는 용도로 사용합니다.
> 이를 통해 AI가 생성한 코드의 실제 동작을 반드시 검증하는 습관을 만들 수 있습니다.
