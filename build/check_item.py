#!/usr/bin/env python3
"""Preflight check for a learning-library item.

Run this BEFORE and AFTER `compile_library_item.py` to catch the failure mode
where a vocab.md parses cleanly but produces empty sections, or produces
sections whose prose was copied from a different item.

    python3 build/check_item.py <item-id>          # human-readable report
    python3 build/check_item.py <item-id> --json   # machine-readable

Exit code 0 = all required sections populated, 1 = problems found.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"

# section prefix -> (field(s) it must fill, human label)
REQUIRED = {
    "七、": (["concepts"], "概念术语"),
    "八、": (["idioms"], "习语/比喻"),
    "十、": (["plan"], "三阶段学习计划"),
    "十一、": (["appendix"], "附录（未出现的表达）"),
    "九、": (["markers", "reductions", "errata", "speed"], "听力障碍分析"),
}

MINIMA = {
    "concepts": 5,
    "idioms": 3,
    "markers": 3,
    "reductions": 3,
    "errata": 2,
    "speed": 2,
    "plan": 3,
    "appendix": 3,
    "method": 1,
    "lead": 1,
}

# Words and phrases are counted together: vocab.md may legitimately use the
# generic "## term" format, where most entries are phrases (life-no-rush has
# 1 word / 20 phrases and is not under-populated).
MIN_ENTITIES = 8

# Numbers that must never appear in more than one item's prose: they are
# per-item measurements. A leak means prose was copied between items.
STAT_RE = re.compile(r"(\d[\d,]*)\s*(?:词|句|章节|次|词/分钟|%)")


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


def load(item_id: str) -> tuple[Path, dict | None, str | None]:
    item = (resolve_library_root() / "items" / item_id).resolve()
    if not item.is_dir():
        return item, None, f"item folder not found: {item}"
    bundle = item / "compiled" / "data.js"
    if not bundle.is_file():
        return item, None, "compiled/data.js missing — run compile_library_item.py first"
    raw = bundle.read_text(encoding="utf-8")
    m = re.search(r"window\.NAVAL_DATA\s*=\s*(.*);\s*$", raw, re.S)
    if not m:
        return item, None, "could not parse window.NAVAL_DATA from compiled/data.js"
    return item, json.loads(m.group(1)), None


def staleness(item: Path, data: dict) -> list[str]:
    notes = []
    bundle = item / "compiled" / "data.js"
    b_mtime = bundle.stat().st_mtime
    for name in ("vocab.md", "transcript.md", "notes.md", "translation.md"):
        f = item / name
        if f.is_file() and f.stat().st_mtime > b_mtime:
            notes.append(f"{name} is newer than compiled/data.js — bundle is STALE, rebuild")
    return notes


TS_RE = re.compile(r"^\*\*\[(\d{1,2}:\d{2}(?::\d{2})?)\]\*\*\s*(.+?)\s*$")


def measure_wpm(item: Path) -> int | None:
    """Compute words-per-minute from this item's own transcript.md.

    Uses the last timestamp as the duration. Returns None when the transcript
    has no parseable timestamped lines.
    """
    f = item / "transcript.md"
    if not f.is_file():
        return None
    words = 0
    last_sec = 0
    for line in f.read_text(encoding="utf-8").splitlines():
        m = TS_RE.match(line.strip())
        if not m:
            continue
        words += len(m.group(2).split())
        parts = [int(x) for x in m.group(1).split(":")]
        sec = parts[0] * 60 + parts[1] if len(parts) == 2 else parts[0] * 3600 + parts[1] * 60 + parts[2]
        last_sec = max(last_sec, sec)
    if not words or last_sec <= 0:
        return None
    return round(words / (last_sec / 60.0))


def vocab_sections(item: Path) -> dict[str, int]:
    """Count H2 sections in vocab.md so we can report missing headings."""
    f = item / "vocab.md"
    if not f.is_file():
        return {}
    counts: dict[str, int] = {}
    for line in f.read_text(encoding="utf-8").splitlines():
        if line.startswith("## ") and not line.startswith("### "):
            title = line[3:].strip()
            for prefix in REQUIRED:
                if title.startswith(prefix):
                    counts[prefix] = counts.get(prefix, 0) + 1
    return counts


def check(item_id: str) -> dict:
    item, data, err = load(item_id)
    result = {"item": item_id, "path": str(item), "ok": False, "errors": [], "warnings": [], "counts": {}}
    if err:
        result["errors"].append(err)
        return result

    listening = data.get("listening") or {}
    entities = data.get("entities") or []
    counts = {
        "words": sum(1 for e in entities if e.get("type") == "word"),
        "phrases": sum(1 for e in entities if e.get("type") == "phrase"),
        "concepts": len(data.get("concepts") or []),
        "idioms": len(data.get("idioms") or []),
        "method": len(data.get("method") or []),
        "plan": len(data.get("plan") or []),
        "appendix": len(data.get("appendix") or []),
        "markers": len(listening.get("markers") or []),
        "reductions": len(listening.get("reductions") or []),
        "errata": len(listening.get("errata") or []),
        "speed": len(listening.get("speed") or []),
        "lead": len(listening.get("lead") or []),
    }
    result["counts"] = counts

    for field, minimum in MINIMA.items():
        if counts.get(field, 0) < minimum:
            result["errors"].append(
                f"{field} has {counts.get(field, 0)} entries, expected >= {minimum}"
            )

    if counts["words"] + counts["phrases"] < MIN_ENTITIES:
        result["errors"].append(
            f"vocab has {counts['words']} words + {counts['phrases']} phrases, "
            f"expected >= {MIN_ENTITIES} combined"
        )

    # required H2 headings actually present in vocab.md
    present = vocab_sections(item)
    missing = [p for p in REQUIRED if p not in present]
    if missing:
        result["errors"].append(
            "vocab.md is missing required H2 section(s): " + ", ".join(missing)
        )

    for note in staleness(item, data):
        result["errors"].append(note)

    # Per-item prose must not carry another item's numbers. Compare any
    # self-claimed wpm against the wpm actually measured from this transcript.
    prose = " ".join(
        listening.get("lead", [])
        + listening.get("markerLead", [])
        + listening.get("errataLead", [])
        + listening.get("speed", [])
    )
    if not prose.strip():
        # reported via the `lead` minimum above; nothing further needed here
        pass
    else:
        measured = measure_wpm(item)
        claimed: set[int] = set()
        for m in re.finditer(r"(\d+)\s*词/分钟", prose):
            before = prose[max(0, m.start() - 8):m.start()]
            if re.search(r"(六级|四级|CET)", before):
                continue  # benchmark reference, not a self-claim
            claimed.add(int(m.group(1)))
        # "约 189 词/分钟" inside a range like "140–160 词/分钟" is a benchmark too:
        # drop any value that falls inside a range already attributed to CET.
        for rng in re.finditer(r"(?:四级|六级|CET)[^。；;]{0,12}?(\d+)\s*[–\-~]\s*(\d+)\s*词/分钟", prose):
            lo, hi = int(rng.group(1)), int(rng.group(2))
            claimed = {c for c in claimed if not (lo <= c <= hi)}
        if measured:
            if not claimed:
                result["warnings"].append(
                    f"prose states no wpm for this item; measured ≈ {measured} wpm"
                )
            for value in sorted(claimed):
                if abs(value - measured) > 12:
                    result["errors"].append(
                        f"prose claims {value} wpm but transcript.md measures ≈ {measured} wpm"
                    )
    if not prose.strip():
        result["errors"].append(
            "listening.lead is empty — the listening page intro would fall back to nothing; "
            "add a §9 intro paragraph describing THIS item's own difficulty"
        )

    result["ok"] = not result["errors"]
    return result


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("item_id")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    res = check(args.item_id)
    if args.json:
        print(json.dumps(res, ensure_ascii=False, indent=2))
        return 0 if res["ok"] else 1

    print(f"item: {res['item']}")
    print(f"path: {res['path']}")
    if res["errors"] and res["errors"][0].startswith("item folder") or (
        len(res["errors"]) == 1 and "compiled/data.js missing" in res["errors"][0]
    ):
        for e in res["errors"]:
            print(f"  ERROR: {e}")
        return 1

    print("counts:")
    for k, v in res["counts"].items():
        flag = "" if v >= MINIMA.get(k, 0) else "   <-- below minimum"
        print(f"  {k:12s} {v}{flag}")
    for e in res["errors"]:
        print(f"  ERROR: {e}")
    for w in res["warnings"]:
        print(f"  WARN:  {w}")
    print("RESULT:", "OK" if res["ok"] else "PROBLEMS FOUND")
    return 0 if res["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
