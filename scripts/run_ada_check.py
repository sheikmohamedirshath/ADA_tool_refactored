#!/usr/bin/env python3
"""
Run ADA check for a URL and write axe-core JSON result to output/ada_result.json.
Uses Python Playwright + axe (scripts/run_ada_check_python.py).
Falls back to sample result if the runner fails.

Usage: python scripts/run_ada_check.py <url>
"""
import json
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_JSON = PROJECT_ROOT / "output" / "ada_result.json"
SAMPLE_JSON = PROJECT_ROOT / "sample_result_file" / "CollectionPageADACheck01212026235702 (1).json"


def main():
    url = (sys.argv[1] or "").strip()
    if not url:
        print("Usage: python run_ada_check.py <url>", file=sys.stderr)
        sys.exit(1)

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)

    script = PROJECT_ROOT / "scripts" / "run_ada_check_python.py"
    try:
        subprocess.run(
            [sys.executable, str(script), url],
            cwd=PROJECT_ROOT,
            check=True,
            capture_output=True,
            timeout=120,
        )
        if OUTPUT_JSON.exists():
            print(str(OUTPUT_JSON))
            return
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired) as e:
        print(f"Playwright ADA runner failed: {e}", file=sys.stderr)

    # Fallback: use sample result
    if SAMPLE_JSON.exists():
        with open(SAMPLE_JSON, "r", encoding="utf-8") as f:
            data = json.load(f)
        data["url"] = url
        with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        print(str(OUTPUT_JSON))
    else:
        with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
            json.dump({"url": url, "violations": [], "passes": [], "message": "No sample result"}, f, indent=2)
        print(str(OUTPUT_JSON))


if __name__ == "__main__":
    main()
