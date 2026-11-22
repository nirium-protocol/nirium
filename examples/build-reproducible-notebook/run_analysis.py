"""Run the analysis on an input file, write results, anchor a receipt."""
import argparse, json, statistics
from pathlib import Path
from run_record import build_record, record_hash
from anchor import anchor, save_receipt

def analyse(inp, out):
    nums = [float(x) for x in Path(inp).read_text().split()]
    Path(out).write_text(json.dumps({"n": len(nums), "mean": statistics.mean(nums)}, indent=2))

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("input"); ap.add_argument("--out", required=True)
    ap.add_argument("--tag", default="wave11-reproducible-notebook")
    a = ap.parse_args()
    analyse(a.input, a.out)
    rec = build_record([a.input], ["run_analysis.py"], [a.out])
    print(save_receipt(anchor(rec, record_hash(rec), a.tag)))
