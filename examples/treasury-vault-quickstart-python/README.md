# Treasury vault quickstart — Python (testnet, non-custodial)

Runnable Python counterpart of [`examples/treasury-vault-quickstart`](../treasury-vault-quickstart).
It uses the same Nirium Python client methods (`deploy_treasury_vault`,
`deposit_to_treasury_vault`, `withdraw_from_treasury_vault`, `submit_treasury_tx`)
but adds the missing runnable example.

**Custody model:** Nirium is an HTTP client only. Every write endpoint returns an
**unsigned XDR**. This script signs it locally with your own testnet keypair and
submits only the signed XDR. The secret never leaves the machine, is never
logged, and is never sent to Nirium.

## Flow

For each on-chain step:

1. `Agent` builds an unsigned XDR.
2. `signing.sign_unsigned_xdr` signs it locally (testnet passphrase only).
3. `Agent.submit_treasury_tx` broadcasts the signed XDR.

The script performs, on `stellar:testnet`:

1. **deploy** a DeFindex vault you own (you keep the Manager role; Nirium only
   ever holds a non-withdrawing RebalanceManager role),
2. **deposit** testnet USDC,
3. **read** the vault state (idle vs invested),
4. **withdraw** everything back to your account.

Set `VAULT_ID` to reuse an existing vault and skip the deploy step.

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env
# edit .env with YOUR OWN funded testnet secret seed (S...)
python quickstart.py
```

Fund the account with Friendbot first: `https://friendbot.stellar.org?addr=<YOUR_G_ADDRESS>`.

## Transaction hashes

The script prints each hash and its Stellar Expert (testnet) link at the end:

| Step | Hash (printed by the script) | Stellar Expert |
|------|------------------------------|----------------|
| deploy | `<deploy hash>` | `https://stellar.expert/explorer/testnet/tx/<deploy hash>` |
| deposit | `<deposit hash>` | `https://stellar.expert/explorer/testnet/tx/<deposit hash>` |
| withdraw | `<withdraw hash>` | `https://stellar.expert/explorer/testnet/tx/<withdraw hash>` |

Paste those lines into your PR description. No hashes are committed here —
they are produced at run time by your own testnet account.

## Errors, explained (no stack traces)

`errors.explain_failure` turns low-level failures into actionable messages:

- **missing trustline / unfunded account** — fund via Friendbot and open the
  Blend testnet USDC trustline (mint at `https://testnet.blend.capital`);
- **wrong passphrase** — this quickstart is testnet-only and must use
  `"Test SDF Network ; September 2015"`;
- **rejected signature** — check the signer matches `caller`/`from`, the
  testnet passphrase was used, and the account sequence is current.

## Tests (no network, no real keys)

```bash
python -m pytest -v
```

11 tests cover: local signing (one signature added), secret never in the
request body (the submit payload contains **only** the signed XDR), public-key
derivation, testnet-only passphrase enforcement, the four explained error
paths, and the full deploy → deposit → read → withdraw flow with a mocked agent.

## Out of scope

Mainnet (Treasury on mainnet is invite-only), any yield/APY figures, and
rebalancing (tracked in a separate issue).
