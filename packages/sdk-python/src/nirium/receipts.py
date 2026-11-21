"""Keep your own copy of an Audit Trail receipt and check it is the original.

A receipt is one IPFS block: a dag-pb node wrapping a UnixFS File whose data is
the whole document (anything up to 256 KiB fits in one block). Its CIDv0 is
base58btc(0x12 0x20 || sha256(node)), the same result ``ipfs add`` gives with its
defaults. Checked on 21 Nov 2026 against three real mainnet receipts.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, Union

_UNIXFS_BLOCK_BYTES = 262144
_BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def _varint(n: int) -> bytes:
    out = bytearray()
    while n >= 0x80:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    out.append(n)
    return bytes(out)


def _bytes_field(tag: int, data: bytes) -> bytes:
    return bytes([tag]) + _varint(len(data)) + data


def _base58btc(data: bytes) -> str:
    n = int.from_bytes(data, "big")
    out = ""
    while n > 0:
        n, rem = divmod(n, 58)
        out = _BASE58_ALPHABET[rem] + out
    for b in data:
        if b != 0:
            break
        out = "1" + out
    return out


def receipt_cid(document: Union[bytes, str, Dict[str, Any]]) -> str:
    """CIDv0 of a receipt, computed locally (no IPFS node, no library).

    Pass the exact bytes you saved, or the ``document`` dict returned by
    ``anchor_audit_record()``. A dict is serialized the way the node pinned it:
    compact JSON (no spaces) with non-ASCII characters kept as UTF-8.
    """
    if isinstance(document, dict):
        data = json.dumps(document, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    elif isinstance(document, str):
        data = document.encode("utf-8")
    else:
        data = bytes(document)
    if not data:
        raise ValueError("receipt_cid: the document is empty")
    if len(data) > _UNIXFS_BLOCK_BYTES:
        raise ValueError(
            f"receipt_cid: {len(data)} bytes is more than one IPFS block ({_UNIXFS_BLOCK_BYTES}); "
            "every Audit Trail receipt fits"
        )
    unixfs = b"\x08\x02" + _bytes_field(0x12, data) + b"\x18" + _varint(len(data))
    node = _bytes_field(0x0A, unixfs)
    return _base58btc(b"\x12\x20" + hashlib.sha256(node).digest())
