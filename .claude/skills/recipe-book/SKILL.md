---
name: recipe-book
description: Use when the user asks for a recipe to add to the recipe book — a dinner idea, a quick meal, a "N분 레시피", or wants to log a variation they tried on an existing recipe ("칠리소스 넣으니 맛있었어", "15분 저녁 레시피 하나", "레시피북에 추가해줘"). Writes a Korean markdown recipe into week-1/quests/레시피북/ with a Ghibli-style AI thumbnail, and appends dated entries to the 만들어 본 기록 log.
---

# 레시피북

`week-1/quests/레시피북/`에 쌓아가는 개인 레시피 모음. 새 레시피를 쓰거나, 이미 있는 레시피에 "만들어 본 기록"을 덧붙인다.

## 🎯 원칙

1. **한국어로, 실제로 요리하면서 읽을 수 있게.** 단계마다 소요 시간을 붙이고 총합이 제목의 시간과 맞아야 한다.
2. **파일 하나 = 레시피 하나.** 파일명은 `<요리이름>.md` (한글, 공백 대신 `-`). 예: `간장버터-닭고기덮밥.md`
3. **썸네일은 항상 넣는다.** `images/<같은-슬러그>-썸네일.jpg`, 16:9.
4. **기록은 지우지 않고 쌓는다.** 사용자가 변형을 시도했다고 하면 「만들어 본 기록」에 날짜와 함께 추가하고, 검증된 변형은 재료·팁에도 반영한다.
5. **커밋은 사용자가 요청할 때만.**

## 📐 레시피 템플릿

````markdown
# <요리 이름>

![<한 줄 이미지 설명>](images/<URL-인코딩된-파일명>.jpg)

> **조리 시간** N분 · **분량** 1~2인분 · **난이도** ★☆☆

<한두 문장 소개. 어떤 상황에 좋은 메뉴인지.>

---

## 재료

**메인**
- 재료 250g — 손질 방법

**소스** (미리 섞어두기)
- 간장 2큰술

**마무리(선택)**
- 반숙 계란 1개

---

## 만드는 법

1. **손질 (3분)**
   ...

2. **굽기 (5분)**
   ...

---

## 팁

- **굵은 글씨 요약** — 왜 그런지 한 줄 설명.

---

## 곁들이면 좋은 것

| 메뉴 | 준비 시간 |
|---|---|
| 오이 무침 | 3분 |

---

## 만들어 본 기록

### YYYY-MM-DD — <시도한 변형> ✅

<맛이 어땠는지 한두 문장.>

- 넣는 시점:
- 양:
- 다음에 시도해볼 것:
````

각 단계는 **굵은 제목 + 소요 시간**, 본문은 들여쓴 한두 문장. 팁은 "무엇을" 굵게 쓰고 `—` 뒤에 "왜"를 붙인다.

## 🖼 썸네일 생성

`scripts/gen_thumbnail.py`가 Gemini 이미지 모델(나노바나나)을 호출한다.

```bash
python .claude/skills/recipe-book/scripts/gen_thumbnail.py \
  --prompt "<장면 묘사>" \
  --out "week-1/quests/레시피북/images/<슬러그>-썸네일.jpg"
```

- **API 키는 `.claude/settings.local.json`의 `env.GEMINI_API_KEY`에 보관돼 있다.** 세션 환경변수로 자동 주입되므로 `export` 할 필요가 없다. 그 파일은 gitignore돼 있다.
- `GEMINI_API_KEY is not set`이 뜨면 세션이 그 설정보다 먼저 시작된 것이다. Claude Code를 재시작하거나, 그 실행 한 번만 앞에 `GEMINI_API_KEY=$(python -c "import json;print(json.load(open('.claude/settings.local.json'))['env']['GEMINI_API_KEY'])")` 를 붙인다.
- **키를 스킬 파일이나 커밋에 하드코딩하지 않는다.** 사용자가 새 키를 주면 `settings.local.json`에 넣고, 노출된 키는 로테이션하라고 알려준다.
- 모델 기본값은 `gemini-3-pro-image`. 빠르고 싼 쪽이 필요하면 `--model gemini-2.5-flash-image`.
- 스크립트가 출력하는 `markdown: images/...` 줄을 그대로 이미지 경로에 붙여넣는다 (한글 파일명은 URL 인코딩이 필요하다).

### 프롬프트 만드는 법

집에서 만든 접시 사진이 아니라 **영화 스틸컷**처럼 쓴다. 이 네 가지를 넣는다:

1. **화풍** — "a still frame from a hand-drawn Japanese animated film, warm painterly 1990s-2000s cel animation"
2. **인물과 감정** — 누가, 어떤 표정으로 먹는지
3. **음식 디테일** — 완성 요리의 실제 재료를 그대로 (윤기 나는 간장 코팅, 반숙 계란 단면, 피어오르는 김)
4. **조명과 구도** — 등불, 창밖의 밤, 수채 배경, 필름 그레인, 시네마틱 와이드

끝에 항상 `No text, no watermark, no lettering.`

**저작권 캐릭터**: 사용자가 특정 애니메이션 주인공을 요청하면, 캐릭터 이름·작품명 대신 **화풍과 장면**으로 묘사한다 ("단발머리 소녀", "등불 켜진 목조 목욕탕 방"). 결과는 원하는 분위기가 나오면서 특정 캐릭터 디자인을 그대로 복제하지 않는다. 이렇게 바꿨다는 걸 사용자에게 알린다.

## ✍️ 파일 편집

한글 파일명 + Windows 환경이라 셸로 직접 편집하면 깨진다. **Python으로 읽고 쓴다**:

```python
import io
p = 'week-1/quests/레시피북/<이름>.md'
s = io.open(p, encoding='utf-8').read()
s = s.replace(old, new)          # 앵커가 유일한지 assert로 확인
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
```

주의할 점:

- `assert s.count(old) == 1` — 조용히 어긋나는 치환을 막는다.
- `newline='\n'` 고정. Git이 CRLF 경고를 내지만 정상이다.
- **Python에서 한글 경로를 print 하지 않는다.** Windows 콘솔이 cp1252로 떨어지면서 `UnicodeEncodeError`가 난다. 확인은 `ls`로 한다.
- Bash 툴은 PowerShell이 아니다. `@'...'@` here-string은 깨진다 — heredoc(`<<'EOF'`)을 쓴다. `git commit -m @'...'@`로 커밋하면 제목 앞에 `@`가 붙는다.

## 🔁 변형 기록하기

사용자가 "이렇게 해먹으니 맛있었어"라고 하면 **세 곳**에 반영한다:

1. **재료 마무리(선택)** — `- **칠리소스 1작은술** — 검증됨, 아래 [만들어 본 기록](#만들어-본-기록) 참고`
2. **팁** — 한 줄 요약
3. **만들어 본 기록** — 오늘 날짜로 새 `###` 항목. 넣는 시점, 양, 다음에 시도해볼 것.

기존 기록은 절대 덮어쓰지 않는다. 날짜는 상대 표현("어제") 대신 절대 날짜로 적는다.

## 💾 커밋

요청받았을 때만. 메시지는 영어, 무엇을 왜 바꿨는지:

```bash
git commit -F - <<'EOF'
Record chili sauce variation in chicken donburi recipe

Tried adding a teaspoon of chili sauce after plating - the heat and
acidity cut the richness of the soy-butter glaze.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```
