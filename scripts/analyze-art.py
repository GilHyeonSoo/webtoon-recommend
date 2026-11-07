#!/usr/bin/env python3
"""Repository-root entry point; works from any current directory, including Korean Windows paths."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools" / "art-style-engine"))

from art_style.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
