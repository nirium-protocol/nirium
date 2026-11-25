# MPP charge on Stellar testnet (WIP, #349)

Status: **blocked** on stellar/stellar-mpp-sdk#108 (npm @stellar/mpp is still 0.7.1, incompatible with stellar-sdk 17 XDR).

Verified locally with @stellar/mpp built from main (95815ac) + mppx 0.13.x:
- Successful testnet charge tx: 5fc8e32fb45c1fb1953739dc54e2ac823fb1bd377aabbcf508a25203d5578902

Plan once published: bump @stellar/mpp, pin mppx 0.13.x in packages/sdk, add this runnable example and a no-network test.
