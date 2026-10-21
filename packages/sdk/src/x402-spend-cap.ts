// ═══════════════════════════════════════════════════════════════
// Error claro para el tope por pago de @x402/core.
//
// Desde @x402/core 2.23.0 el cliente rechaza, al seleccionar los requisitos
// y antes de crear el payload, todo pago por encima de un tope por defecto
// ($1). Lo hace con un Error genérico que x402Fetch re-envuelve
// ("Failed to create payment payload: All payment requirements were
// rejected by spendControls.maxAmountPerPayment (...)"), sin decir cuánto se
// pedía ni que nadie firmó nada. Este módulo reconoce ese caso y lo convierte
// en un error que lo dice. El tope se configura con initX402({ maxAmountPerPayment }) (#106).
// ═══════════════════════════════════════════════════════════════

/** One payment option from the server's 402 response, as x402 v2 sends it. */
export interface X402OfferedRequirement {
    scheme?: string;
    network?: string;
    asset?: string;
    amount?: string;
}

export interface X402SpendCapErrorDetails {
    url: string;
    /** Atomic units the server asked for (the cheapest offer when there are several). */
    amount?: string;
    asset?: string;
    network?: string;
    /** The cap as @x402/core states it, e.g. "$1". */
    cap?: string;
    /** Human reading of `amount` when the asset is a known default asset, e.g. "2 USDC". */
    formattedAmount?: string;
    cause?: unknown;
}

/**
 * x402Fetch refused to pay because the amount the server asked for is above
 * the per-payment cap enforced by @x402/core. Thrown before the signer is
 * reached: nothing was signed, nothing was sent.
 */
export class X402SpendCapError extends Error {
    readonly code = 'X402_SPEND_CAP_EXCEEDED' as const;
    /** Always false for this error: the cap is checked before any signing. */
    readonly signerCalled = false as const;
    readonly url: string;
    readonly amount?: string;
    readonly asset?: string;
    readonly network?: string;
    readonly cap?: string;
    readonly formattedAmount?: string;

    constructor(d: X402SpendCapErrorDetails) {
        const asked = d.formattedAmount
            ? `${d.formattedAmount} (${d.amount} atomic units)`
            : d.amount !== undefined
                ? `${d.amount} atomic units${d.asset ? ` of ${d.asset}` : ''}`
                : 'more than the cap';
        const cap = d.cap ? `the per-payment cap is ${d.cap}` : 'it is above the per-payment cap';
        super(
            `x402Fetch refused to pay ${d.url}: the server asked for ${asked} and ${cap}. `
            + 'The signer was not called; nothing was signed or sent. '
            + 'The cap is enforced by @x402/core; raise it explicitly with initX402({ maxAmountPerPayment }).',
            d.cause !== undefined ? { cause: d.cause } : undefined,
        );
        this.name = 'X402SpendCapError';
        this.url = d.url;
        this.amount = d.amount;
        this.asset = d.asset;
        this.network = d.network;
        this.cap = d.cap;
        this.formattedAmount = d.formattedAmount;
    }
}

const isAtomic = (v: unknown): v is string => typeof v === 'string' && /^\d+$/.test(v);

/** `20000000` with 7 decimals and `USDC` -> `2 USDC`. */
export function formatAtomic(amount: string, decimals: number, symbol: string): string {
    const raw = BigInt(amount);
    const base = 10n ** BigInt(decimals);
    const whole = raw / base;
    const frac = (raw % base).toString().padStart(decimals, '0').replace(/0+$/, '');
    return `${frac ? `${whole}.${frac}` : whole.toString()} ${symbol}`;
}

/**
 * Reads the `accepts` list out of a 402 response's PAYMENT-REQUIRED header
 * (base64 JSON, x402 v2). Returns undefined if it is absent or unreadable;
 * the error is still produced, just without the amount.
 */
export function readOfferedRequirements(response: { headers: { get(name: string): string | null } }): X402OfferedRequirement[] | undefined {
    try {
        const header = response.headers.get('payment-required');
        if (!header) return undefined;
        const bytes = Uint8Array.from(atob(header), (c) => c.charCodeAt(0));
        const accepts = JSON.parse(new TextDecoder().decode(bytes))?.accepts;
        return Array.isArray(accepts) ? accepts : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Wraps a fetch so the requirements of every 402 it sees are written to
 * `sink`. Passive: the response is returned untouched.
 */
export function captureRequirements(
    base: typeof fetch,
    sink: { offered?: X402OfferedRequirement[] },
): typeof fetch {
    return (async (input: any, init?: any) => {
        const response: Response = await base(input, init);
        if (response.status === 402) {
            const offered = readOfferedRequirements(response);
            if (offered) sink.offered = offered;
        }
        return response;
    }) as typeof fetch;
}

// El mensaje de @x402/core que reconocemos. Si una versión futura lo cambia,
// el error genérico vuelve a salir tal cual (sin perder nada) y el test que lo
// fija (test/x402-spend-cap.test.ts) falla al subir la dependencia.
const CAP_REJECTION = /rejected by spendControls\.maxAmountPerPayment(?: \(([^)]*)\))?/;

/**
 * If `error` is @x402/core refusing a payment for being above its
 * per-payment USD cap, returns the clear error; otherwise null so the caller
 * rethrows the original. Other spendControls rejections (for example a
 * non-default asset) are deliberately left alone.
 */
export function toSpendCapError(
    error: unknown,
    url: string,
    offered: X402OfferedRequirement[] | undefined,
    describeAsset?: (asset: string, network: string) => { decimals: number; symbol: string } | undefined,
): X402SpendCapError | null {
    const message = error instanceof Error ? error.message : '';
    const hit = CAP_REJECTION.exec(message);
    if (!hit) return null;
    // "($1, including USDC)" -> "$1"
    const cap = hit[1]?.split(',')[0]?.trim() || undefined;
    const cheapest = (offered ?? [])
        .filter((o) => isAtomic(o.amount))
        .sort((a, b) => (BigInt(a.amount!) < BigInt(b.amount!) ? -1 : BigInt(a.amount!) > BigInt(b.amount!) ? 1 : 0))[0];
    let formattedAmount: string | undefined;
    if (cheapest?.asset && cheapest.network) {
        try {
            const info = describeAsset?.(cheapest.asset, cheapest.network);
            if (info) formattedAmount = formatAtomic(cheapest.amount!, info.decimals, info.symbol);
        } catch { /* sin formato legible: se informan las unidades atómicas */ }
    }
    return new X402SpendCapError({
        url, cap, formattedAmount, cause: error,
        amount: cheapest?.amount, asset: cheapest?.asset, network: cheapest?.network,
    });
}
