#!/usr/bin/env python3
"""Generate a recipe thumbnail with the Gemini image model (Nano Banana).

Usage:
    export GEMINI_API_KEY=...
    python gen_thumbnail.py --prompt "<scene description>" \
        --out "week-1/quests/레시피북/images/<slug>-썸네일.jpg"

Prints the saved path and the URL-encoded relative path to paste into markdown.
"""
import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
DEFAULT_MODEL = "gemini-3-pro-image"  # Nano Banana Pro. Cheaper: gemini-2.5-flash-image


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--out", required=True, help="output image path (.jpg)")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--aspect", default="16:9")
    args = ap.parse_args()

    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        print("ERROR: GEMINI_API_KEY is not set", file=sys.stderr)
        return 2

    body = json.dumps({
        "contents": [{"parts": [{"text": args.prompt}]}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {"aspectRatio": args.aspect},
        },
    }).encode("utf-8")

    req = urllib.request.Request(
        ENDPOINT.format(model=args.model),
        data=body,
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:
        print("HTTP %s: %s" % (e.code, e.read().decode("utf-8", "replace")[:800]), file=sys.stderr)
        return 1

    for cand in data.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            if "inlineData" in part:
                out = os.path.abspath(args.out)
                os.makedirs(os.path.dirname(out), exist_ok=True)
                with open(out, "wb") as f:
                    f.write(base64.b64decode(part["inlineData"]["data"]))
                # ASCII-only output: Windows consoles default to cp1252 and
                # raise UnicodeEncodeError when printing Korean filenames.
                print("saved %d bytes" % os.path.getsize(out))
                print("markdown: images/%s" % urllib.parse.quote(os.path.basename(out)))
                return 0
            if "text" in part:
                print("MODEL TEXT: %s" % part["text"][:500], file=sys.stderr)

    print("no image in response; finishReason=%s" % [c.get("finishReason") for c in data.get("candidates", [])], file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
