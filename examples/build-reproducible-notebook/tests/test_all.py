import shutil, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from run_record import build_record, record_hash
from anchor import anchor
from check_run import check

fake_signer = lambda s, h: ("GFAKE", "c2ln")
fake_client = lambda p: {"cid": "bafyfake", "anchoredAt": "2026-11-22T00:00:00Z"}

class T(unittest.TestCase):
    def setUp(self):
        self.d = Path(tempfile.mkdtemp())
        (self.d / "in.txt").write_text("1 2 3"); (self.d / "code.py").write_text("x")
        (self.d / "out.json").write_text("{}")
        self.rec = build_record(["in.txt"], ["code.py"], ["out.json"], self.d)
        self.rcpt = anchor(self.rec, record_hash(self.rec), "wave11-test", "s", fake_signer, fake_client)
    def tearDown(self): shutil.rmtree(self.d)
    def test_ok(self): self.assertTrue(check(self.rcpt, self.d, verify=False)[0])
    def test_tampered_input(self):
        (self.d / "in.txt").write_text("1 2 4"); self.assertFalse(check(self.rcpt, self.d, verify=False)[0])
    def test_tampered_output(self):
        (self.d / "out.json").write_text("{1}"); self.assertFalse(check(self.rcpt, self.d, verify=False)[0])
    def test_different_inputs_different_hash(self):
        (self.d / "in.txt").write_text("9"); r2 = build_record(["in.txt"], ["code.py"], ["out.json"], self.d)
        self.assertNotEqual(record_hash(r2), self.rcpt["hash"])
    def test_tag_enforced(self):
        with self.assertRaises(ValueError): anchor(self.rec, "h", "bad", "s", fake_signer, fake_client)
    def test_cli_failure(self):
        class R: returncode, stdout, stderr = 1, "", "bad"
        self.assertFalse(check(self.rcpt, self.d, True, lambda *a, **k: R())[0])

if __name__ == "__main__": unittest.main()
