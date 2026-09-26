#!/usr/bin/env python3
"""Compile a Markdown managed video study item into the legacy browser bundle."""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def resolve_library_root() -> Path:
    configured = os.environ.get("ENGLISH_LIBRARY_ROOT", "").strip()
    if not configured:
        try:
            configured = (ROOT / ".library-root").read_text(encoding="utf-8").strip()
        except OSError:
            configured = ""
    if configured:
        return Path(configured).expanduser().resolve()
    return (ROOT / ".." / ".." / "Sync" / "English" / "learning-library").resolve()


LIBRARY = resolve_library_root()
ITEMS = LIBRARY / "items"


def read_translation(path: Path, sentence_rows: list[list]) -> tuple[list[str], list[str]]:
    chapter = []
    sentence = []
    in_chapters = False
    in_sentences = False
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip() == "## Chapters":
            in_chapters, in_sentences = True, False
        elif line.strip() == "## Sentences":
            in_chapters, in_sentences = False, True
        elif in_chapters:
            m = re.match(r"-\s+\[c\d+\]\s+(.*)$", line)
            if m:
                chapter.append(m.group(1))
        elif in_sentences:
            m = re.match(r"-\s+\[s\d+\s+@\s+[^]]+\]\s+(.*)$", line)
            if m:
                sentence.append(m.group(1))
    if sentence:
        return chapter, sentence

    # General bilingual transcript format: timestamped English line followed by Chinese line.
    rows = []
    pending_sec = None
    for line in path.read_text(encoding="utf-8").splitlines():
        m = re.match(r"\*\*\[(\d{1,2}:\d{2}(?::\d{2})?)\]\*\*\s*(.*)", line.strip())
        if m:
            mm = m.group(1).split(":")
            pending_sec = int(mm[-2]) * 60 + int(mm[-1]) if len(mm) == 3 else int(mm[0]) * 60 + int(mm[1])
        elif pending_sec is not None and line.strip() and not line.lstrip().startswith((">", "#")):
            rows.append((pending_sec, line.strip()))
            pending_sec = None
    if not rows:
        return [], []
    aligned = []
    for row in sentence_rows:
        nearest = min(rows, key=lambda candidate: abs(candidate[0] - row[0]))
        aligned.append(nearest[1])
    return [], aligned


def read_core_logic(path: Path) -> list[dict]:
    """Read reusable concept-page cards from notes.md."""
    if not path.exists():
        return []
    cards = []
    in_section = False
    title = None
    body = []

    def flush() -> None:
        nonlocal title, body
        if title and body:
            cards.append({"disp": title, "desc": " ".join(body), "framework": True})
        title, body = None, []

    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line == "## 核心逻辑卡片":
            in_section = True
            continue
        if in_section and line.startswith("## "):
            flush()
            break
        if not in_section:
            continue
        heading = re.match(r"###\s+(.+)$", line)
        if heading:
            flush()
            title = heading.group(1).strip()
        elif title and line and not line.startswith(">"):
            body.append(line)
    else:
        if in_section:
            flush()
    return cards


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("item_id", nargs="?", default="naval-44-harsh-truths")
    args = parser.parse_args()
    item = (ITEMS / args.item_id).resolve()
    if ITEMS.resolve() not in item.parents:
        raise SystemExit("invalid item id")
    transcript = item / "transcript.md"
    vocab = item / "vocab.md"
    translations = item / "translation.md"
    compiled = item / "compiled"
    compiled.mkdir(parents=True, exist_ok=True)

    subprocess.run([
        sys.executable, str(ROOT / "build" / "generate_data.py"),
        "--transcript", str(transcript), "--vocab", str(vocab),
        "--out", str(compiled / "data.js"),
    ], check=True)

    data = json.loads(re.search(r"window\.NAVAL_DATA\s*=\s*(.*);\s*$", (compiled / "data.js").read_text(encoding="utf-8"), re.S).group(1))
    core_logic = read_core_logic(item / "notes.md")
    if core_logic:
        data["coreLogic"] = core_logic
        (compiled / "data.js").write_text(
            "window.NAVAL_DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n",
            encoding="utf-8",
        )
    chapters, sentences = read_translation(translations, data["sentences"])
    if not chapters and data["chapters"]:
        chapters = [c["title"] for c in data["chapters"]]
    if len(chapters) != len(data["chapters"]) or len(sentences) != len(data["sentences"]):
        raise SystemExit(
            f"translation count mismatch: chapters {len(chapters)}/{len(data['chapters'])}, "
            f"sentences {len(sentences)}/{len(data['sentences'])}"
        )
    payload = "window.NAVAL_SENT_CN = " + json.dumps(sentences, ensure_ascii=False, separators=(",", ":")) + ";\n"
    payload += "window.NAVAL_CH_CN = " + json.dumps(chapters, ensure_ascii=False, separators=(",", ":")) + ";\n"
    (compiled / "data.cn.js").write_text(payload, encoding="utf-8")
    print(f"compiled {args.item_id}: {len(chapters)} chapters, {len(sentences)} translated sentences")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
