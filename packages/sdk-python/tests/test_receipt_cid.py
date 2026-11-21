"""receipt_cid: recompute a receipt's CID locally. Fixtures are two real mainnet
receipts, byte for byte as the gateway serves them (shared with the CLI tests)."""

import json
from pathlib import Path

import pytest

from nirium import receipt_cid

FIXTURES = Path(__file__).resolve().parents[2] / "cli" / "test" / "fixtures" / "receipts"
CIDS = ["QmSSZdtt3dQ8BqUm62zrKQ85E4BUHYiVfvDgZmHfJsqU1U", "QmS5q2NvZ2K2StLB3KCWRdkBtnZ5rHAJrQAez2PnKAPwTk"]


@pytest.mark.parametrize("cid", CIDS)
def test_real_receipt_bytes_give_back_their_cid(cid):
    data = (FIXTURES / f"{cid}.json").read_bytes()
    assert receipt_cid(data) == cid
    assert receipt_cid(data.decode("utf-8")) == cid


@pytest.mark.parametrize("cid", CIDS)
def test_parsed_document_gives_back_the_same_cid(cid):
    doc = json.loads((FIXTURES / f"{cid}.json").read_text(encoding="utf-8"))
    assert receipt_cid(doc) == cid


def test_one_changed_byte_changes_the_cid():
    data = bytearray((FIXTURES / f"{CIDS[0]}.json").read_bytes())
    data[-2] ^= 1
    assert receipt_cid(bytes(data)) != CIDS[0]


def test_refuses_empty_and_multi_block_input():
    with pytest.raises(ValueError, match="empty"):
        receipt_cid(b"")
    with pytest.raises(ValueError, match="one IPFS block"):
        receipt_cid(b"a" * 262145)
