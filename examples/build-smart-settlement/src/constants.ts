/** 0.02 USDC at 7 decimals. */
export const PRICE_ATOMIC = 200_000n;
/** Three successful payments at PRICE_ATOMIC. The fourth payable delivery is refused. */
export const DAILY_CAP_ATOMIC = PRICE_ATOMIC * 3n;
