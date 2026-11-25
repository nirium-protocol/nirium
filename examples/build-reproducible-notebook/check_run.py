"""check-run: recompute a record from local files, then run `nirium verify`."""
import argparse, json, subprocess, sys
from run_record import rebuild, record_hash

def check(receipt, root=".", verify=True, runner=subprocess.run):
    recomputed = record_hash(rebuild(receipt["record"], root))
    if recomputed != receipt["hash"]:
        return False, f"FAIL: files changed (expected {receipt['hash']}, got {recomputed})"
    if verify:
        r = runner(["npx", "nirium-cli", "verify", receipt["cid"], "--hash", receipt["hash"]],
                   capture_output=True, text=True)
        if r.returncode != 0:
            return False, "FAIL: nirium verify\n" + (r.stdout or "") + (r.stderr or "")
    return True, "OK: record matches files" + (" and passes nirium verify" if verify else "")

def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("receipt"); ap.add_argument("--root", default=".")
    ap.add_argument("--skip-cli", action="store_true")
    a = ap.parse_args(argv)
    ok, msg = check(json.load(open(a.receipt)), a.root, not a.skip_cli)
    print(msg); return 0 if ok else 1

if __name__ == "__main__":
    sys.exit(main())
