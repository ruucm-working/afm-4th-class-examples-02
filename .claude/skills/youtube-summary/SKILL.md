---
name: youtube-summary
description: Use when the user wants a YouTube video downloaded, transcribed, or summarized into markdown — pasting a YouTube URL with "요약해줘", "자막 받아줘", "정리해줘", "영상 다운받아줘", or asking for a transcript/summary file from a video ("이 영상 마크다운으로 정리해줘", "자막도 같이 받아줘", "summarize this video"). Downloads with yt-dlp, converts auto-captions into a deduplicated transcript, and writes paired 자막전문/요약 markdown files into week-N/class/yt-dlp/.
---

# 유튜브 영상 요약

yt-dlp로 영상과 자막을 받아, **자막 전문 마크다운**과 **요약 마크다운** 두 개를 짝으로 만든다.

## 🎯 원칙

1. **파일은 항상 두 개.** 전문과 요약을 분리한다. 요약만 필요하다고 해도 전문을 먼저 만들어야 인용이 정확해진다.
2. **없는 내용을 채우지 않는다.** ASR이 뭉갠 구간은 추측으로 메우지 말고 그대로 비워둔 뒤 "확실하지 않은 구간"에 적는다.
3. **고친 것은 기록한다.** 오인식 보정은 전문 파일 하단에 `원본 → 수정 → 근거` 표로 남긴다.
4. **영상 파일은 커밋하지 않는다.** 문서(`.md`)와 자막(`.srt`)만 추적한다. 아래 「저장 위치」 참고.
5. **커밋은 사용자가 요청할 때만.**

## 📋 작업 순서

### 1. 자막 확인

```bash
yt-dlp --js-runtimes node --list-subs "<URL>"
```

- **수동 자막(Available subtitles)이 있으면 무조건 그쪽을 쓴다.** 사람이 단 자막이라 보정이 거의 필요 없다.
- 자동 자막(Available automatic captions)만 있으면 ASR이므로 4단계 보정이 필수다.
- 한국어 영상이면 `ko`가 원본 음성 인식이고, 나머지 언어는 `ko`를 기계번역한 것이라 품질이 더 나쁘다. **번역본 말고 원어를 받는다.**

### 2. 다운로드

```bash
# 영상 + 자막 한 번에
yt-dlp --js-runtimes node \
  -f "bv*[vcodec^=avc1]+ba[ext=m4a]/bv*+ba/b" --merge-output-format mp4 \
  --write-subs --write-auto-subs --sub-langs "ko" --convert-subs srt \
  -o "%(title)s.%(ext)s" "<URL>"

# 자막만
yt-dlp --js-runtimes node --skip-download \
  --write-subs --write-auto-subs --sub-langs "ko" --convert-subs srt \
  -o "%(title)s.%(ext)s" "<URL>"
```

- **`--js-runtimes node`를 항상 붙인다.** 빼면 "No supported JavaScript runtime" 경고와 함께 일부 포맷이 누락된다. 기본값이 `deno`인데 이 PC엔 node만 있다.
- **`-f`의 `vcodec^=avc1`는 H.264를 고른다.** 안 쓰면 AV1+Opus로 받아져서 구형 플레이어·편집 프로그램에서 안 열린다.
- `--write-subs --write-auto-subs`를 같이 주면 수동 자막이 있을 때 그쪽이 우선된다.
- 병합에 ffmpeg이 필요하다 (winget `Gyan.FFmpeg`으로 설치돼 있음).

### 3. 자막 → 마크다운 초안

```bash
python .claude/skills/youtube-summary/scripts/srt_to_md.py "<자막.srt>" \
  -o "<출력.md>" --title "<제목>" --url "<URL>"
```

자동 자막의 롤업 중복(같은 문장이 여러 블록에 반복 + 0.01초짜리 빈 블록)을 걷어내고 문장 단위로 합쳐준다. 실제로 87블록 → 18문장으로 줄었다.

**이 스크립트는 글자를 고치지 않는다.** 오인식 보정은 다음 단계에서 문맥을 보고 직접 한다.

### 4. 오인식 보정 (자동 자막일 때만)

초안을 읽고 **문맥상 명백한 것만** 고친다. 주로 고유명사·한자어가 깨진다.

| 유형 | 실제 사례 |
|---|---|
| 인명 + 직함 | `팀 애플전 최고 경영자` → `팀 쿡 애플 최고경영자(CEO)` |
| 제품명 | `갤럭시 G 폴데이` → `갤럭시 Z 폴드` |
| 한자어 | `배체하고` → `배치하고`, `동명이임` → `동명이인` |
| 맞춤법 | `베겼다` → `베꼈다`, `개시물` → `게시물` |
| 조사 | `취지에 메시지` → `취지의 메시지` |
| 표기 흔들림 | `파머스터노스` / `파머스턴노스` → 하나로 통일 |

**애매하면 고치지 말고 남긴다.** 뜻이 안 잡히는 단어는 빼고 쓴 뒤 "확실하지 않은 구간"에 근거와 함께 적는다. 실제로 `우리는 여기서 세격으로 접고 있을게요`의 `세격으로`는 끝내 복원하지 못해 단어를 뺀 채로 두고 명시했다.

### 5. 두 파일 작성

아래 템플릿을 따른다. **Write 도구로 쓴다** — Git Bash 히어독은 한글이 깨진다.

## 📐 전문 파일 템플릿

`<출처>_<주제-슬러그>_자막전문.md`

````markdown
# <영상 제목>

> **출처** <채널명> · <URL>
> **길이** N분 N초
> **자막** 수동 자막 / YouTube 자동 생성(ASR) 자막  ← 둘 중 실제인 것
> **정리일** YYYY-MM-DD

---

## 자막 전문

**00:00** <문장>

**00:05** <문장>

---

## 정리 시 적용한 보정   ← 자동 자막일 때만

| 원본(ASR) | 수정 | 근거 |
|---|---|---|
| ... | ... | ... |

### 확실하지 않은 구간

- **MM:SS** <어디가 어떻게 불확실한지, 왜 추측하지 않았는지>
````

## 📐 요약 파일 템플릿

`<출처>_<주제-슬러그>_요약.md`

````markdown
# 요약 · <주제>

> **원본** <채널> 「<제목>」 (N분 N초)
> <URL>
> **전문** [<전문파일명>.md](<전문파일명>.md)

---

## 한 줄 요약

<굵은 글씨로 핵심 하나. 두 문장 넘기지 않는다.>

## 핵심 내용

### 1. <소주제>
- 불릿 3~5개

### 2. <소주제>
<비교·나열이 많으면 표를 쓴다>

## 짚어볼 점

- **<관점>** — 사실 나열 너머의 맥락. 왜 지금인지, 누가 이득인지, 제목이 낚시인지 등.

---

*원본 자막은 YouTube 자동 생성(ASR) 자막이며, 오인식을 보정해 정리했습니다. 보정 내역은 전문 파일 하단에 있습니다.*
````

## 📁 저장 위치

`week-<N>/class/yt-dlp/` — `N`은 저장소에서 가장 높은 주차 번호. 새 주차를 만들어야 하면 사용자에게 먼저 확인한다.

```
week-4/class/yt-dlp/
├─ <제목>.mp4                    ← 커밋하지 않음
├─ <제목>.ko.srt
├─ <출처>_<주제>_자막전문.md
└─ <출처>_<주제>_요약.md
```

**영상 파일은 `.gitignore`에 넣는다.** 이 저장소는 `.git`이 10MB 수준이고 추적 중인 최대 파일이 1MB짜리 스크린샷이다. 영상 하나가 그 전체보다 크다. 커밋 전에 사용자에게 알리고, 기본은 "문서·자막만 커밋"으로 제안한다.

## ⚠️ Windows 함정

- **한글 파일명을 읽을 땐 PowerShell을 쓴다.** Git Bash는 콘솔 인코딩 때문에 한글을 `� '' []` 처럼 뭉갠다. 파일 자체는 멀쩡하고 표시만 깨지는 것이라, 결과 확인은 이렇게 한다:
  ```powershell
  [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
  ```
  `Get-Content -Encoding utf8`은 이 PC의 PowerShell 5.1에서 실패한다.
- **yt-dlp가 파일명을 자동 치환한다.** Windows에서 못 쓰는 `"` `/` 를 생김새가 비슷한 `＂` `⧸` 로 바꾼다. 정상 동작이니 고치려 들지 않는다. 다만 문서 파일명은 이 문자를 피해 직접 짓는다.
- **진행률 로그가 터미널을 덮는다.** `--newline`을 주거나 `grep -vE "^\[download\] +[0-9]"` 로 걸러서 본다.
