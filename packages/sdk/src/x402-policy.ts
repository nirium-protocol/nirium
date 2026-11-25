// ═══════════════════════════════════════════════════════════════
// Pre-sign policy hook for x402Fetch (#96).
//
// El punto de evaluación envuelve al signer SEP-43 porque es el único lugar
// donde existe la autorización que se va a firmar: ExactStellarScheme la arma
// dentro de createPaymentPayload (simulación RPC incluida) y stellar-sdk la
// entrega a signAuthEntry como HashIdPreimage en base64. El hook
// onBeforePaymentCreation de @x402/core corre ANTES de eso: ve los requisitos,
// pero todavía no hay nonce, expiración ni invocación que atar.
// ═══════════════════════════════════════════════════════════════

import { xdr, hash, Networks, Address, scValToNative } from '@stellar/stellar-sdk';

export type X402PolicyVerdict = 'ALLOW' | 'DENY' | 'WAIT';

export interface X402PaymentRequirementsView {
    scheme: string;
    network: string;
    asset: string;
    payTo: string;
    amount: string;
    maxTimeoutSeconds: number;
}

export interface X402PolicyContext {
    /** Version of this object's shape, so an engine knows what it is reading. */
    contextVersion: 1;
    /** URL and method exactly as passed to x402Fetch. */
    url: string;
    method: string;
    /** The requirements the server asked for and x402 selected. */
    requirements: Readonly<X402PaymentRequirementsView>;
    /** What is actually about to be signed, decoded from the bytes. */
    authorization: Readonly<{
        preimageXdr: string;
        /** 'legacy' (ENVELOPE_TYPE_SOROBAN_AUTHORIZATION) or 'cap71' (…WithAddress). */
        preimageType: 'legacy' | 'cap71';
        /** sha256(preimage) in hex: exactly the payload ed25519 signs. */
        payloadHash: string;
        networkPassphrase: string;
        nonce: string;
        signatureExpirationLedger: number;
        contractId: string;
        functionName: string;
        from: string;
        to: string;
        amount: string;
    }>;
    signer: string;
    /** sha256 of {url, method, payloadHash}. An ALLOW must echo it back unchanged. */
    contextHash: string;
}

export interface X402PolicyDecision {
    decision: X402PolicyVerdict;
    /** Required on ALLOW: binds the decision to this authorization and no other. */
    contextHash?: string;
    reason?: string;
    /**
     * Opaque to Nirium. Preserved in errors and onDecision. Required on ALLOW
     * when `currentVersion` is configured: it is what gets compared.
     */
    policyVersion?: string;
    /** Epoch ms. If it has passed by signing time, nothing is signed. Equality counts as expired. */
    expiresAt?: number;
    decisionId?: string;
}

export type X402PolicyOutcome =
    | 'ALLOWED' | 'SIGNED' | 'SIGNER_ERROR' | 'DENY' | 'WAIT' | 'TIMEOUT' | 'ENGINE_ERROR'
    | 'EXPIRED' | 'UNBOUND' | 'MALFORMED' | 'CONTEXT_MISMATCH'
    | 'STALE' | 'VERSION_UNAVAILABLE' | 'SIGNER_CHANGED' | 'CLOCK_INVALID';

/**
 * `ALLOWED`: the engine's ALLOW is well formed, bound to this authorization
 * and not expired yet. It is a notice, not a result: the observer runs here,
 * and the freshness and identity checks that follow it can still refuse
 * (STALE, EXPIRED, TIMEOUT, CLOCK_INVALID, VERSION_UNAVAILABLE, SIGNER_CHANGED).
 * `SIGNED`: the signer returned a signature. `SIGNER_ERROR`: the signer
 * rejected, threw, or returned no `signedAuthEntry`. Every other value is a
 * refusal and nothing was signed.
 * Sequence: `ALLOWED`, then either a refusal, or exactly one of `SIGNED` or
 * `SIGNER_ERROR`. Refusals that happen before the ALLOW is accepted (DENY, WAIT,
 * UNBOUND, MALFORMED, TIMEOUT or ENGINE_ERROR while evaluating, CONTEXT_MISMATCH)
 * are a single record with no `ALLOWED`.
 */
export interface X402PolicyRecord {
    outcome: X402PolicyOutcome;
    context?: X402PolicyContext;
    decision?: X402PolicyDecision;
    error?: string;
}

/**
 * Pre-sign policy hook (#96). Runs after the Stellar authorization is built
 * and before anything is signed. Only an ALLOW bound to this exact
 * authorization, and still valid, reaches the signer. Anything else (DENY,
 * WAIT, error, timeout, malformed or stale answer) signs nothing. Nirium never
 * stores or owns the policy; it asks and obeys.
 *
 * Authorizations that are not a single `transfer(from, to, amount)` matching
 * the selected requirements are rejected before the policy is consulted.
 */
export interface X402PolicyHook {
    evaluate: (ctx: X402PolicyContext, opts: { signal: AbortSignal }) => Promise<X402PolicyDecision>;
    /**
     * Optional source of the policy version currently in force. When set, it is
     * read after an ALLOW and right before signing; the ALLOW signs only if its
     * `policyVersion` equals what this returns. A rejection, an empty answer or
     * running past the deadline signs nothing.
     *
     * This check is NOT atomic with signing: the version can change after it is
     * read, or while the signer runs. It narrows the stale-ALLOW window to the
     * synchronous step between this read and the signer call; it does not close it.
     * The `onDecision` observer runs before this read, so a version change it
     * causes is seen by it.
     */
    currentVersion?: (ctx: X402PolicyContext, opts: { signal: AbortSignal }) => Promise<string>;
    /**
     * Hard deadline for the whole pre-sign phase (evaluate + currentVersion).
     * Default 5000 ms, and never more than half the payment's maxTimeoutSeconds.
     */
    timeoutMs?: number;
    /** If true, an ALLOW without expiresAt is treated as unsignable. Default false. */
    requireExpiry?: boolean;
    /**
     * Observer for receipts (see X402PolicyRecord for the sequence). Cannot
     * change the outcome. A synchronous throw is swallowed. If it returns a
     * promise (or any thenable) it is not awaited, so it cannot delay or block a
     * payment, and its rejection is swallowed so it never becomes an
     * unhandledRejection.
     */
    onDecision?: (record: X402PolicyRecord) => void;
    /**
     * Injectable clock (epoch ms), for tests. It must return a finite number
     * every time it is read: anything else (NaN, undefined, a string, a throw)
     * refuses the payment with CLOCK_INVALID, because every comparison against
     * NaN is false and a deadline that can never be reached would sign.
     */
    now?: () => number;
}

/** Outcomes that mean no signature was released (the payment is refused). */
export type X402PolicyRefusal = Exclude<X402PolicyOutcome, 'ALLOWED' | 'SIGNED'>;

export class X402PolicyError extends Error {
    readonly outcome: X402PolicyRefusal;
    readonly decision?: X402PolicyDecision;
    readonly contextHash?: string;
    constructor(
        outcome: X402PolicyRefusal,
        message: string,
        extra: { decision?: X402PolicyDecision; contextHash?: string } = {},
    ) {
        super(`x402 policy ${outcome}: ${message}`);
        this.name = 'X402PolicyError';
        this.outcome = outcome;
        this.decision = extra.decision;
        this.contextHash = extra.contextHash;
    }
}

const PASSPHRASES: Record<string, string> = {
    'stellar:testnet': Networks.TESTNET,
    'stellar:pubnet': Networks.PUBLIC,
};

const DEFAULT_TIMEOUT_MS = 5000;

const hex = (b: Buffer | Uint8Array) => Buffer.from(b).toString('hex');
const sha256hex = (s: string) => hex(hash(Buffer.from(s, 'utf8')));
const nonempty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

type SignOpts = { networkPassphrase?: string; address?: string };
type SignFn = (authEntry: string, opts?: SignOpts) =>
    Promise<{ signedAuthEntry: string; signerAddress?: string }>;
export type X402BaseSigner = { address: string; signAuthEntry: SignFn };

/** Validates a policy hook at initX402 time, so bad config fails before any payment. */
export function assertValidPolicyHook(policy: X402PolicyHook): void {
    if (!policy || typeof policy !== 'object' || typeof policy.evaluate !== 'function') {
        throw new Error('initX402: `policy.evaluate` must be a function.');
    }
    if (policy.currentVersion !== undefined && typeof policy.currentVersion !== 'function') {
        throw new Error('initX402: `policy.currentVersion`, when set, must be a function.');
    }
    if (policy.timeoutMs !== undefined
        && (!Number.isSafeInteger(policy.timeoutMs) || policy.timeoutMs <= 0)) {
        throw new Error('initX402: `policy.timeoutMs` must be a positive integer (ms).');
    }
    if (policy.now !== undefined && typeof policy.now !== 'function') {
        throw new Error('initX402: `policy.now`, when set, must be a function returning epoch milliseconds.');
    }
}

/**
 * Decodes the preimage and checks it describes exactly the payment x402
 * selected. This is not policy (that belongs to the engine): it is context
 * integrity, so that what the engine evaluates is what gets signed.
 */
export function describeAuthorization(
    preimageXdr: string,
    requirements: X402PaymentRequirementsView,
    signerAddress: string,
): X402PolicyContext['authorization'] {
    let pre: any;
    try {
        pre = xdr.HashIdPreimage.fromXdr(preimageXdr, 'base64');
    } catch (e: any) {
        throw new X402PolicyError('CONTEXT_MISMATCH', `undecodable auth preimage (${e?.message})`);
    }
    // Dos variantes: la clásica, y la de CAP-71 que además ata la dirección
    // dentro de lo firmado. En la segunda, esa dirección tiene que ser el signer.
    let auth: any;
    let preimageType: 'legacy' | 'cap71';
    switch (pre.type) {
        case 'envelopeTypeSorobanAuthorization':
            auth = pre.sorobanAuthorization;
            preimageType = 'legacy';
            break;
        case 'envelopeTypeSorobanAuthorizationWithAddress':
            auth = pre.sorobanAuthorizationWithAddress;
            preimageType = 'cap71';
            if (Address.fromScAddress(auth.address).toString() !== signerAddress) {
                throw new X402PolicyError('CONTEXT_MISMATCH', 'CAP-71 preimage is bound to a different address than the signer');
            }
            break;
        default:
            throw new X402PolicyError('CONTEXT_MISMATCH', `unsupported preimage type ${pre.type}`);
    }
    const passphrase = PASSPHRASES[requirements.network];
    if (!passphrase) throw new X402PolicyError('CONTEXT_MISMATCH', `unknown network ${requirements.network}`);
    if (hex(auth.networkId.value) !== hex(hash(Buffer.from(passphrase)))) {
        throw new X402PolicyError('CONTEXT_MISMATCH', 'auth entry is for a different network than requirements.network');
    }
    const inv = auth.invocation;
    if (inv.subInvocations.length !== 0) {
        throw new X402PolicyError('CONTEXT_MISMATCH', 'auth entry carries sub-invocations');
    }
    const fn = inv.function;
    if (fn.type !== 'sorobanAuthorizedFunctionTypeContractFn') {
        throw new X402PolicyError('CONTEXT_MISMATCH', `unexpected authorized function ${fn.type}`);
    }
    const call = fn.contractFn;
    const contractId = Address.fromScAddress(call.contractAddress).toString();
    const functionName = call.functionName.toString();
    const rawArgs = call.args;
    if (functionName !== 'transfer' || rawArgs.length !== 3) {
        throw new X402PolicyError('CONTEXT_MISMATCH', `expected transfer(from,to,amount), got ${functionName}/${rawArgs.length}`);
    }
    if (rawArgs[0].type !== 'scvAddress' || rawArgs[1].type !== 'scvAddress'
        || rawArgs[2].type !== 'scvI128') {
        throw new X402PolicyError('CONTEXT_MISMATCH', 'transfer arguments have unexpected types');
    }
    const from = Address.fromScAddress(rawArgs[0].address).toString();
    const to = Address.fromScAddress(rawArgs[1].address).toString();
    const amount = BigInt(scValToNative(rawArgs[2])).toString();
    if (contractId !== requirements.asset) throw new X402PolicyError('CONTEXT_MISMATCH', 'asset contract differs from requirements.asset');
    if (to !== requirements.payTo) throw new X402PolicyError('CONTEXT_MISMATCH', 'destination differs from requirements.payTo');
    if (amount !== requirements.amount) throw new X402PolicyError('CONTEXT_MISMATCH', 'amount differs from requirements.amount');
    if (from !== signerAddress) throw new X402PolicyError('CONTEXT_MISMATCH', 'from differs from signer address');
    return Object.freeze({
        preimageXdr,
        preimageType,
        payloadHash: hex(hash(pre.toXdr())),
        networkPassphrase: passphrase,
        nonce: auth.nonce.toString(),
        signatureExpirationLedger: auth.signatureExpirationLedger,
        contractId, functionName, from, to, amount,
    });
}

/** min(timeoutMs ?? 5000, maxTimeoutSeconds * 1000 / 2): a slow engine must not eat the payment window. */
export function effectiveTimeoutMs(policy: X402PolicyHook, maxTimeoutSeconds?: number): number {
    const base = policy.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (typeof maxTimeoutSeconds === 'number' && Number.isFinite(maxTimeoutSeconds) && maxTimeoutSeconds > 0) {
        return Math.max(1, Math.min(base, Math.floor((maxTimeoutSeconds * 1000) / 2)));
    }
    return base;
}

/**
 * Wraps a signer so it only signs with a current ALLOW bound to this auth
 * entry. Anything else ends without a signature.
 *
 * `getCall` supplies the per-call context (URL, method, requirements): one
 * gated signer is created per x402Fetch, so two concurrent payments never
 * share state. `onRefused` receives the error before it is thrown, because
 * @x402/fetch re-wraps errors and loses their class.
 *
 * Not a security boundary against code in the same process: anyone holding
 * the base signer can still call it directly. Callbacks (`evaluate`,
 * `currentVersion`, `onDecision`) all run before the final clock and identity
 * checks, so what they change in the clock, the version source or the base
 * signer's `address` is detected. Replacing `base.signAuthEntry` itself is not:
 * it is looked up at call time, after those checks.
 */
export function createPolicyGatedSigner(
    base: X402BaseSigner,
    policy: X402PolicyHook,
    getCall: () => { url: string; method: string; requirements?: X402PaymentRequirementsView },
    onRefused?: (error: X402PolicyError) => void,
): X402BaseSigner {
    // La identidad se fija aquí. Si el signer base cambia de dirección a mitad
    // del pago, no se firma: lo evaluado se evaluó para esta cuenta.
    const account = base.address;
    const now = policy.now ?? Date.now;
    // Un reloj que no devuelve un número finito cierra: NaN hace falsa cada
    // comparación (`t >= deadline`), y un plazo que nunca se alcanza firmaría.
    const readClock = (context?: X402PolicyContext, decision?: X402PolicyDecision): number => {
        let t: unknown;
        try { t = now(); } catch (e: any) {
            return refuse('CLOCK_INVALID', `clock threw (${e?.message ?? String(e)})`, context, decision);
        }
        if (typeof t !== 'number' || !Number.isFinite(t)) {
            return refuse('CLOCK_INVALID', `clock returned ${String(t)}, not epoch milliseconds`, context, decision);
        }
        return t;
    };
    const report = (r: X402PolicyRecord) => {
        try {
            const out: unknown = policy.onDecision?.(r);
            // Un observador async que rechaza no puede tumbar el proceso con un
            // unhandledRejection. No se espera: el signer no depende de él.
            if (out !== null && (typeof out === 'object' || typeof out === 'function')) {
                Promise.resolve(out).catch(() => { /* idem */ });
            }
        } catch { /* un observador no decide nada */ }
    };
    const refuse = (
        outcome: X402PolicyRefusal, msg: string,
        context?: X402PolicyContext, decision?: X402PolicyDecision,
    ): never => {
        report({ outcome, context, decision, error: msg });
        const err = new X402PolicyError(outcome, msg, { decision, contextHash: context?.contextHash });
        try { onRefused?.(err); } catch { /* idem */ }
        throw err;
    };

    const signAuthEntry: SignFn = async (preimageXdr, opts) => {
        const call = getCall();
        if (!call.requirements) refuse('CONTEXT_MISMATCH', 'no payment requirements bound to this signing call');
        if (base.address !== account) refuse('SIGNER_CHANGED', 'base signer address changed after the gate was created');
        if (opts?.address && opts.address !== account) refuse('CONTEXT_MISMATCH', 'asked to sign for a different address');

        let authorization: X402PolicyContext['authorization'];
        try {
            authorization = describeAuthorization(preimageXdr, call.requirements!, account);
        } catch (e: any) {
            return refuse(e instanceof X402PolicyError ? e.outcome : 'CONTEXT_MISMATCH', e?.message ?? String(e));
        }
        const contextHash = sha256hex(JSON.stringify({ v: 1, url: call.url, method: call.method, payloadHash: authorization.payloadHash }));
        // Congelado: el engine lee, no reescribe lo que se firma.
        const context: X402PolicyContext = Object.freeze({
            contextVersion: 1 as const, url: call.url, method: call.method,
            requirements: Object.freeze({ ...call.requirements! }),
            authorization,
            signer: account, contextHash,
        });

        const timeoutMs = effectiveTimeoutMs(policy, call.requirements!.maxTimeoutSeconds);
        const controller = new AbortController();
        // Un solo plazo para toda la fase previa a la firma (evaluate + currentVersion).
        const deadline = readClock(context) + timeoutMs;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const TIMED_OUT = Symbol('timeout');
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => { controller.abort(); reject(TIMED_OUT); }, timeoutMs);
        });
        timeout.catch(() => { /* se consume aquí; cada race lo vuelve a observar */ });

        try {
            let decision: X402PolicyDecision;
            try {
                decision = await Promise.race([
                    Promise.resolve().then(() => policy.evaluate(context, { signal: controller.signal })),
                    timeout,
                ]);
            } catch (e: any) {
                if (e === TIMED_OUT) return refuse('TIMEOUT', `no decision within ${timeoutMs} ms`, context);
                return refuse('ENGINE_ERROR', e?.message ?? String(e), context);
            }

            // Todo lo que no sea un ALLOW bien formado cierra.
            if (!decision || typeof decision !== 'object') return refuse('MALFORMED', 'engine returned no decision object', context);
            if (decision.decision === 'DENY') return refuse('DENY', decision.reason ?? 'denied', context, decision);
            if (decision.decision === 'WAIT') return refuse('WAIT', decision.reason ?? 'wait', context, decision);
            if (decision.decision !== 'ALLOW') return refuse('MALFORMED', `unknown verdict ${String((decision as any).decision)}`, context, decision);
            // Se copian los campos antes de cualquier await: mutar el objeto del
            // engine después no extiende ni cambia esta decisión.
            const allow: X402PolicyDecision = Object.freeze({ ...decision });
            if (allow.contextHash !== contextHash) return refuse('UNBOUND', 'ALLOW is not bound to this authorization', context, allow);
            if (allow.expiresAt !== undefined
                && (typeof allow.expiresAt !== 'number' || !Number.isFinite(allow.expiresAt))) {
                return refuse('MALFORMED', 'expiresAt must be epoch milliseconds', context, allow);
            }
            if (allow.expiresAt === undefined && policy.requireExpiry) {
                return refuse('EXPIRED', 'ALLOW without expiresAt while requireExpiry is set', context, allow);
            }
            const checkClock = () => {
                const t = readClock(context, allow);
                if (t >= deadline) refuse('TIMEOUT', 'decision arrived after the deadline', context, allow);
                if (allow.expiresAt !== undefined && t >= allow.expiresAt) refuse('EXPIRED', 'ALLOW expired before signing', context, allow);
            };
            if (policy.currentVersion && !nonempty(allow.policyVersion)) {
                return refuse('MALFORMED', 'ALLOW has no policyVersion to check against currentVersion', context, allow);
            }
            checkClock();

            // El observador corre AQUI y no junto al signer: todo lo que provoque
            // (adelantar el reloj, cambiar la versión de la política, cambiar la
            // dirección del signer) lo ven las comprobaciones que siguen. Lo que
            // hace un callback después de la última de ellas ya no existe: entre
            // la última comprobación y el signer no corre código ajeno.
            report({ outcome: 'ALLOWED', context, decision: allow });

            if (policy.currentVersion) {
                let current: unknown;
                try {
                    current = await Promise.race([
                        Promise.resolve().then(() => policy.currentVersion!(context, { signal: controller.signal })),
                        timeout,
                    ]);
                } catch (e: any) {
                    if (e === TIMED_OUT) return refuse('TIMEOUT', `no current policy version within ${timeoutMs} ms`, context, allow);
                    return refuse('VERSION_UNAVAILABLE', `currentVersion failed (${e?.message ?? String(e)})`, context, allow);
                }
                if (!nonempty(current)) return refuse('VERSION_UNAVAILABLE', 'currentVersion returned no version', context, allow);
                if (current !== allow.policyVersion) {
                    return refuse('STALE', `ALLOW was issued under policy ${allow.policyVersion}, current is ${current}`, context, allow);
                }
            }

            // Comprobaciones finales, siempre, y sin ningún await antes del signer:
            // el reloj se vuelve a leer (después del observador y del await de la
            // versión) y la identidad se compara por última vez.
            checkClock();
            if (base.address !== account) return refuse('SIGNER_CHANGED', 'base signer address changed while the policy was evaluated', context, allow);
            // La fase previa terminó: la firma no tiene plazo propio, así que el
            // temporizador ya no pinta nada.
            if (timer) clearTimeout(timer);
            // SIGNED solo existe si el signer devolvió una firma. Los bytes son
            // los del parámetro original, no una copia que alguien pudo tocar.
            let signed: Awaited<ReturnType<SignFn>>;
            try {
                signed = await base.signAuthEntry(preimageXdr, opts);
            } catch (e: any) {
                // El error del signer se relanza tal cual: no es una negativa de la política.
                report({ outcome: 'SIGNER_ERROR', context, decision: allow, error: e?.message ?? String(e) });
                throw e;
            }
            if (!signed || typeof signed !== 'object' || !nonempty(signed.signedAuthEntry)) {
                return refuse('SIGNER_ERROR', 'signer returned no signedAuthEntry', context, allow);
            }
            report({ outcome: 'SIGNED', context, decision: allow });
            return signed;
        } finally {
            if (timer) clearTimeout(timer);
        }
    };

    return { address: account, signAuthEntry };
}
