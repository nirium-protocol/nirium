"""Build a canonical run record: hashes of inputs, code and outputs."""
import hashlib, json
from pathlib import Path

VERSION = "nirium-run-record-v1"

def sha256_file(path, chunk=1 << 20):
    h = hashlib.sha256()
    with open(path, "rb") as f:  # streamed: large files are hashed, never uploaded
        while block := f.read(chunk):
            h.update(block)
    return h.hexdigest()

def _entries(paths, root):
    return {Path(p).as_posix(): sha256_file(Path(root) / p) for p in sorted(paths)}

def build_record(inputs, code, outputs, root="."):
    return {"version": VERSION,
            "inputs": _entries(inputs, root),
            "code": _entries(code, root),
            "outputs": _entries(outputs, root)}

def canonical(record):
    return json.dumps(record, sort_keys=True, separators=(",", ":"))

def record_hash(record):
    return hashlib.sha256(canonical(record).encode()).hexdigest()

def rebuild(record, root="."):
    """Recompute a record from the files named in an existing one."""
    return build_record(record["inputs"], record["code"], record["outputs"], root)
