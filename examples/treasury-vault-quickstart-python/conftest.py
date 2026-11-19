"""Make the local SDK importable without installing it."""

import sys
from pathlib import Path

SDK_SRC = Path(__file__).resolve().parents[2] / "packages" / "sdk-python" / "src"
if SDK_SRC.is_dir() and str(SDK_SRC) not in sys.path:
    sys.path.insert(0, str(SDK_SRC))
