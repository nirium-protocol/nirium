"""Sign and anchor a run-record hash through the Nirium Audit Trail (client only)."""
import base64, json, os
from pathlib import Path

NODE = "https://nirium-agent.fly.dev"   # testnet node, POST /api/audit/log
PREFIX = "nirium-audit-v1:"

def stellar_sign(secret, record_hash):
    from stellar_sdk import Keypair      # pip install stellar-sdk
    kp = Keypair.from_secret(secret)
    sig = kp.sign((PREFIX + record_hash).encode())
    return kp.public_key, base64.b64encode(sig).decode()

def sdk_anchor(payload):
    # TODO(check SDK docs): confirm the exact anchor_audit_record signature.
    from nirium import anchor_audit_record
    return anchor_audit_record(**payload)

def anchor(record, record_hash, tag, secret=None, signer=stellar_sign, client=sdk_anchor):
    if not tag.startswith("wave11-"):
        raise ValueError("tag must start with 'wave11-'")
    secret = secret or os.environ["STELLAR_TESTNET_SECRET"]  # never commit keys
    agent, signature = signer(secret, record_hash)
    resp = client({"hash": record_hash, "agent": agent, "statement": PREFIX + record_hash,
                   "signature": signature, "tag": tag, "node": NODE})
    return {"cid": resp["cid"], "hash": record_hash, "agent": agent, "tag": tag,
            "anchoredAt": resp.get("anchoredAt"), "record": record}

def save_receipt(receipt, directory="receipts"):
    Path(directory).mkdir(exist_ok=True)
    path = Path(directory) / f"{receipt['hash'][:12]}.json"
    path.write_text(json.dumps(receipt, indent=2))
    return path
