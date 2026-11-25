"""One-time stellar:testnet setup: a payer and a seller account, both with a USDC trustline.

    python setup_testnet.py

- Creates two fresh keypairs and funds them with Friendbot (testnet XLM).
- Adds a USDC trustline to both (the seller needs one to receive).
- Buys 5 testnet USDC for the payer on the testnet DEX with XLM.
- Writes STELLAR_SECRET_KEY (payer) and SELLER_PUBLIC_KEY to .env.

The seller's secret is printed once for you to keep. It is not written to .env:
the server only needs the public key.
"""

from __future__ import annotations

import os
import sys

import httpx
from stellar_sdk import Asset, Keypair, Network, Server, TransactionBuilder

HORIZON = "https://horizon-testnet.stellar.org"
USDC = Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5")
EXPERT = "https://stellar.expert/explorer/testnet"


def submit(server: Server, kp: Keypair, build) -> str:
    account = server.load_account(kp.public_key)
    tx = build(TransactionBuilder(account, Network.TESTNET_NETWORK_PASSPHRASE, 1000)).set_timeout(60).build()
    tx.sign(kp)
    return server.submit_transaction(tx)["hash"]


def main() -> None:
    if os.path.exists(".env"):
        sys.exit(".env already exists; move it away first so no key is overwritten.")
    server = Server(HORIZON)
    payer, seller = Keypair.random(), Keypair.random()

    for name, kp in (("payer", payer), ("seller", seller)):
        httpx.get("https://friendbot.stellar.org", params={"addr": kp.public_key}, timeout=60).raise_for_status()
        tx = submit(server, kp, lambda b: b.append_change_trust_op(USDC))
        print(f"{name:6} {kp.public_key}  trustline {EXPERT}/tx/{tx}")

    tx = submit(server, payer, lambda b: b.append_path_payment_strict_receive_op(
        payer.public_key, Asset.native(), "20", USDC, "5", []))
    print(f"payer bought 5 USDC: {EXPERT}/tx/{tx}")

    with open(".env", "w") as f:
        f.write(f"STELLAR_SECRET_KEY={payer.secret}\nSELLER_PUBLIC_KEY={seller.public_key}\n"
                "FACILITATOR_API_KEY=\nX402_PRICE=$0.01\n")
    os.chmod(".env", 0o600)
    print("\nWrote .env (payer secret + seller public key). Add FACILITATOR_API_KEY to it.")
    print(f"Seller secret, keep it somewhere safe (not needed by the server): {seller.secret}")


if __name__ == "__main__":
    main()
