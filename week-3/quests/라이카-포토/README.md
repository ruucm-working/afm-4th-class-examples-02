# LEICA LAB — 라이카 감성 사진 생성기

장면을 한 줄로 쓰고 **렌즈 · 필름 · 빛 · 무드**를 고르면, 그 조합을 프롬프트로 번역해
fal.ai FLUX 로 "라이카로 찍은 듯한" 사진을 만들어 주는 앱.

- `index.html` — CDN React 18 + Tailwind 단일 파일 프런트엔드 (API 키를 모른다)
- `server.js` — Express 백엔드. 환경변수 `FAL_KEY` 로 fal.ai 를 대신 호출하는 프록시

## 실행

```bash
npm install
cp .env.example .env      # FAL_KEY 값을 채운다
npm start                 # → http://localhost:3000
```

`index.html` 을 파일로 직접 열면 동작하지 않는다. 반드시 서버를 통해 접속할 것.

## 환경변수

| 이름 | 필수 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `FAL_KEY` | ✅ | — | fal.ai API 키 (`<key-id>:<key-secret>`). https://fal.ai/dashboard/keys |
| `PORT` | | `3000` | 서버 포트 |
| `FAL_TIMEOUT_MS` | | `120000` | fal.ai 호출 타임아웃 |
| `RATE_LIMIT_MAX` | | `40` | IP당 10분 내 최대 생성 요청 수 |

`.env` 는 `.gitignore` 에 포함되어 커밋되지 않는다. 키는 코드 어디에도 하드코딩하지 않으며,
브라우저로도 내려보내지 않는다 (`/api/health` 는 설정 여부만 알려준다).

## API

| 메서드 | 경로 | 요청 body | 응답 |
| --- | --- | --- | --- |
| GET | `/api/health` | — | `{ success, data: { status, keyConfigured, generatedCount } }` |
| GET | `/api/presets` | — | `{ success, data: { models, ratios, lenses, films, lights, moods, ideas } }` |
| GET | `/api/history` | — | `{ success, data: Shot[] }` (인메모리, 최근 36건) |
| POST | `/api/generate` | `{ scene, lens, film, light, mood, ratio, model, count, seed }` | `{ success, data: { shots, prompt, seed } }` |

`POST /api/generate` 의 선택값(`lens`/`film`/`light`/`mood`/`ratio`/`model`)은 서버가 가진
프리셋 id 여야 하며, 최종 프롬프트도 **서버가 조립**한다. 클라이언트는 프롬프트 미리보기만 같은 규칙으로 그린다.

실패 응답은 모두 `{ success: false, message }` 형태다 (400 검증, 429 호출 제한, 504 타임아웃, 500 키 미설정).

## 프롬프트 조립 규칙

```
장면 → 무드 → 빛 → 렌즈 → 필름 → 라이카 룩 베이스
```

렌즈/필름 프리셋은 실제 광학·필름 특성을 영문 묘사로 옮긴 것이다.
예를 들어 `noctilux50` 은 `razor-thin plane of focus, swirling dreamy bokeh` 로,
`cinestill800t` 은 `cool cyan shadows, red halation glow` 로 번역된다.

## 배포 (Vercel)

`vercel.json` 이 포함되어 있다. 대시보드에서 환경변수 `FAL_KEY` 를 등록하면 그대로 배포된다.

## 주의

생성 이미지는 fal.ai 서버의 링크(`v3b.fal.media/...`)로, 시간이 지나면 만료될 수 있다.
브라우저 히스토리(localStorage)에도 URL만 저장되므로, 마음에 드는 사진은 **이미지 저장**으로 내려받을 것.
