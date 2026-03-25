# Auto Dub

오디오/비디오 파일을 업로드하면 지정한 언어로 자동 더빙된 결과물을 반환하는 음성 더빙 서비스입니다.

## 기능

- 오디오(MP3, M4A, WAV, FLAC) 및 비디오(MP4, MOV, AVI, MKV, WebM) 파일 지원
- 파일 업로드 후 구간 슬라이더로 시작/끝 지점 선택 (최대 60초)
- ElevenLabs API를 활용한 전사 → 번역 → 음성 합성 파이프라인
- 더빙된 오디오/비디오 재생 및 다운로드
- Google OAuth 로그인 + 화이트리스트(관리자) / 일반 사용자 기반 접근 제어
- 미승인 사용자의 접근 요청 기능 (관리자 승인 후 이용 가능)
- 관리자 페이지에서 접근 요청 승인, 일반 사용자 추가/삭제

## 기술 스택

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS v4**
- **ElevenLabs API** — STT / 번역 / TTS
- **fluent-ffmpeg + ffmpeg-static** — 서버 사이드 오디오 추출 및 오디오 먹싱
- **@ffmpeg/ffmpeg (WASM)** — 클라이언트 사이드 오디오/비디오 크롭 (WASM 바이너리는 `public/ffmpeg/`에 로컬 서빙)
- **NextAuth.js v5** — Google OAuth 인증
- **Turso (libSQL)** — 관리자 화이트리스트 / 일반 사용자 / 접근 요청 DB
- **Vitest** — 단위 테스트


### 더빙 처리 흐름

```
파일 업로드 → ElevenLabs API 전송
  → [전사] 원본 음성 → 텍스트
  → [번역] 텍스트 → 목표 언어
  → [합성] 번역 텍스트 → 더빙 음성
  → (비디오인 경우) FFmpeg으로 원본 영상 + 더빙 음성 병합
  → 결과 미리듣기 & 다운로드
```


## 로컬 실행 방법

### 1. 사전 준비

- Node.js 18+
- npm

### 2. 저장소 클론 및 의존성 설치

```bash
git clone https://github.com/your-username/auto-dub.git
cd auto-dub
npm install
node scripts/download-ffmpeg.js  # FFmpeg WASM 바이너리 다운로드 (dev 서버 실행 전 필요)
```

> `npm run build` 시에는 `prebuild`로 자동 실행됩니다.

### 3. 환경변수 설정

`.env.local` 파일을 생성하고 아래 값을 채워넣으세요:

```
ELEVENLABS_API_KEY=         # ElevenLabs API 키
AUTH_SECRET=                # NextAuth.js 시크릿 (openssl rand -base64 32)
AUTH_GOOGLE_ID=             # Google OAuth 클라이언트 ID
AUTH_GOOGLE_SECRET=         # Google OAuth 클라이언트 시크릿
TURSO_DATABASE_URL=         # Turso DB URL
TURSO_AUTH_TOKEN=           # Turso 인증 토큰
```

> **참고**: Google OAuth 클라이언트는 [Google Cloud Console](https://console.cloud.google.com)에서,
> ElevenLabs API 키는 [ElevenLabs](https://elevenlabs.io) 대시보드에서 발급받을 수 있습니다.

### 4. Turso DB 설정

Turso DB에는 아래 3개 테이블이 사용됩니다. `users`와 `access_requests`는 서버 최초 실행 시 자동 생성되며, `whitelist`는 수동으로 생성 및 관리합니다.

```sql
-- 관리자 (수동 관리)
CREATE TABLE whitelist (email TEXT PRIMARY KEY);
INSERT INTO whitelist (email) VALUES ('admin@example.com');

-- 일반 사용자 / 접근 요청 (서버 실행 시 자동 생성)
-- users, access_requests 테이블은 자동 생성됩니다.
```

관리자(`whitelist`)로 등록된 계정은 `/admin` 페이지에서 접근 요청을 승인하고 일반 사용자를 관리할 수 있습니다.

### 5. 개발 서버 실행

[http://localhost:3000](http://localhost:3000)에서 확인할 수 있습니다.

#### 명령어

```bash
npm run dev           # 개발 서버 실행
npm run build         # 프로덕션 빌드
npm run start         # 프로덕션 서버 실행
npm run lint          # ESLint 실행
npm run test          # 테스트 실행
npm run test:watch    # TDD watch 모드
npm run test:coverage # 커버리지 리포트
```




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
