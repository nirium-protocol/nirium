import os
import sys

HERE = os.path.dirname(__file__)
EXAMPLE = os.path.abspath(os.path.join(HERE, ".."))
REPO_ROOT = os.path.abspath(os.path.join(EXAMPLE, "..", ".."))

for path in (EXAMPLE, os.path.join(REPO_ROOT, "packages", "sdk-python", "src")):
    if path not in sys.path:
        sys.path.insert(0, path)
