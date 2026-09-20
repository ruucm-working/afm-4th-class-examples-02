#!/usr/bin/env python3
"""SRT/VTT 자막을 중복 없는 마크다운 초안으로 변환한다.

YouTube 자동 생성(ASR) 자막은 '롤업' 방식이라 같은 문장이 여러 블록에
반복되고, 0.01초짜리 빈 블록이 사이사이 끼어 있다. 이 스크립트는 그걸
걷어내고 문장 단위로 합쳐 타임스탬프를 붙인 초안을 만든다.

출력은 어디까지나 '초안'이다. ASR 오인식 보정은 사람(=Claude)이 문맥을
보고 해야 하며, 이 스크립트는 글자를 고치지 않는다.

사용법:
    python srt_to_md.py <자막파일> [-o 출력.md] [--title "제목"] [--url URL]
"""

import argparse
import re
import sys
from pathlib import Path

TIME_RE = re.compile(r"(\d+):(\d\d):(\d\d)[,.](\d+)\s*-->")
# 롤업 중복 판정 시 거슬러 올라가 비교할 직전 줄 개수.
# 뉴스 자막은 보통 2줄 롤업이라 4면 넉넉하고, 진짜로 반복되는
# 후렴구까지 지워버릴 만큼 넓지는 않다.
LOOKBACK = 4


def parse_blocks(path: Path):
    """자막 파일을 (시작초, [본문줄]) 목록으로 파싱한다.

    빈 줄로 큐를 나누지 않는다. YouTube 자동 자막은 타임스탬프 바로 뒤에
    빈 줄이 오는 큐가 섞여 있어서, 빈 줄 기준으로 자르면 그 큐의 첫 본문이
    타임스탬프를 잃고 통째로 버려진다.
    """
    # utf-8-sig: yt-dlp가 BOM을 붙여 내보내는 경우가 있다.
    text = path.read_text(encoding="utf-8-sig").replace("\r\n", "\n")
    blocks, start, body = [], None, []

    def flush():
        # 다음 큐의 인덱스 번호가 본문 끝에 딸려 들어온 것을 떼어낸다.
        while body and not body[-1].strip():
            body.pop()
        if body and body[-1].strip().isdigit():
            body.pop()
        if start is not None:
            blocks.append((start, list(body)))

    for line in text.split("\n"):
        m = TIME_RE.match(line.strip())
        if m:
            flush()
            h, mnt, s, _ = m.groups()
            start = int(h) * 3600 + int(mnt) * 60 + int(s)
            body = []
        elif start is not None:
            body.append(line)
    flush()
    return blocks


def dedupe(blocks):
    """롤업 중복을 제거하고 (줄이 처음 등장한 시각, 줄) 목록을 만든다."""
    items, recent = [], []
    for start, body in blocks:
        for line in body:
            line = line.strip()
            # [음악], [박수] 같은 효과음 태그만 있는 줄은 남겨둔다 —
            # 리포트 끝을 알려주는 단서가 된다.
            if not line or line in recent[-LOOKBACK:]:
                continue
            recent.append(line)
            items.append((start, line))
    return items


def to_sentences(items):
    """줄 단위를 문장 단위로 다시 묶는다.

    롤업 자막은 문장 경계가 줄 중간에 걸쳐 있어서(예: "...있습니다. 디스전의")
    줄 끝을 기준으로 자를 수 없다. 전체를 이어붙인 뒤 문장부호로 자르고,
    각 문장이 시작된 위치를 되짚어 타임스탬프를 찾는다.
    """
    text, marks = "", []
    for start, line in items:
        marks.append((len(text), start))
        text += line + " "
    text = text.strip()
    if not text:
        return []

    sentences = [s for s in re.split(r"(?<=[.!?。])\s+", text) if s.strip()]
    out, cursor = [], 0
    for sentence in sentences:
        idx = text.find(sentence, cursor)
        if idx < 0:
            idx = cursor
        start = next(
            (ts for off, ts in reversed(marks) if off <= idx),
            marks[0][1],
        )
        out.append((start, sentence.strip()))
        cursor = idx + len(sentence)
    return out


def fmt(seconds: int) -> str:
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("subtitle", type=Path, help="입력 .srt 또는 .vtt")
    ap.add_argument("-o", "--output", type=Path, help="출력 .md (기본: 표준출력)")
    ap.add_argument("--title", default=None, help="문서 제목")
    ap.add_argument("--url", default=None, help="원본 영상 URL")
    args = ap.parse_args()

    if not args.subtitle.exists():
        sys.exit(f"자막 파일을 찾을 수 없습니다: {args.subtitle}")

    sentences = to_sentences(dedupe(parse_blocks(args.subtitle)))
    if not sentences:
        sys.exit(f"자막에서 본문을 찾지 못했습니다: {args.subtitle}")

    lines = [f"# {args.title or args.subtitle.stem}", ""]
    if args.url:
        lines += [f"> **출처** <{args.url}>", ""]
    lines += ["---", "", "## 자막 전문 (자동 변환 초안)", ""]
    for start, sentence in sentences:
        lines.append(f"**{fmt(start)}** {sentence}")
        lines.append("")

    result = "\n".join(lines).rstrip() + "\n"
    if args.output:
        args.output.write_text(result, encoding="utf-8")
        print(f"{args.output} ({len(sentences)}문장)")
    else:
        sys.stdout.reconfigure(encoding="utf-8")
        print(result)


if __name__ == "__main__":
    main()
