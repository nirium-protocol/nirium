import type {
  X402PolicyContext,
  X402PolicyDecision,
  X402PolicyHook,
  X402PolicyRecord,
} from "nirium";

const TESTNET_USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

export class DailyBudgetPolicy {
  private readonly spentByDay = new Map<string, bigint>();
  private readonly version = "energy-grid-budget-v1";
  readonly records: X402PolicyRecord[] = [];

  constructor(
    private readonly dailyCap: bigint,
    private readonly allowedPayTos: ReadonlySet<string>,
    private readonly now: () => number = Date.now,
  ) {
    if (dailyCap <= 0n) throw new Error("dailyCap must be positive");
  }

  spentToday(signer: string): bigint {
    return this.spentByDay.get(`${signer}:${this.dayKey()}`) ?? 0n;
  }

  hook(): X402PolicyHook {
    return {
      evaluate: async (ctx) => this.evaluate(ctx),
      currentVersion: async () => this.version,
      requireExpiry: true,
      onDecision: (record) => this.records.push(record),
    };
  }

  private async evaluate(ctx: X402PolicyContext): Promise<X402PolicyDecision> {
    const policyVersion = this.version;
    const { requirements, authorization } = ctx;
    if (
      requirements.network !== "stellar:testnet" ||
      requirements.asset !== TESTNET_USDC ||
      !this.allowedPayTos.has(requirements.payTo) ||
      authorization.to !== requirements.payTo ||
      authorization.from !== ctx.signer
    ) {
      return { decision: "DENY", reason: "payment is not for an allowed testnet producer", policyVersion };
    }

    if (!/^[1-9]\d*$/.test(authorization.amount)) {
      return { decision: "DENY", reason: "payment amount is not a positive integer", policyVersion };
    }

    const amount = BigInt(authorization.amount);
    const key = `${ctx.signer}:${this.dayKey()}`;
    const spent = this.spentByDay.get(key) ?? 0n;
    if (spent + amount > this.dailyCap) {
      return {
        decision: "DENY",
        reason: `daily budget exceeded: spent ${spent}, requested ${amount}, cap ${this.dailyCap}`,
        policyVersion,
      };
    }

    this.spentByDay.set(key, spent + amount);
    const now = this.now();
    return {
      decision: "ALLOW",
      contextHash: ctx.contextHash,
      policyVersion,
      expiresAt: now + 2_000,
      decisionId: `${key}:${authorization.nonce}`,
    };
  }

  private dayKey(): string {
    return new Date(this.now()).toISOString().slice(0, 10);
  }
}
