// Mock for @stellar/stellar-sdk for testing purposes
// Provides only the exports needed by x402-policy.ts and tests

export const Networks = {
  TESTNET: 'Test SDF Network ; September 2015',
  PUBLIC: 'Public Global Stellar Network ; September 2015',
};

export class Address {
  static fromString(str: string): Address {
    return new Address(str);
  }
  static fromScAddress(scAddress: any): Address {
    return new Address(scAddress.toString?.() || 'mock-address');
  }
  constructor(public readonly address: string) {}
  toString(): string {
    return this.address;
  }
}

export const xdr = {
  // Mock XDR types as needed
  ScVal: class {},
  ScAddress: class {},
  AccountId: class {},
  PublicKey: class {},
  Uint256: class {},
  HashIdPreimage: class {
    static fromXDR(data: string, format: string): any {
      return { data, format };
    }
  },
};

export const hash = (data: Buffer): Buffer => {
  // Simple mock hash
  return Buffer.from('mock-hash');
};

export const scValToNative = (val: any): any => val;

// Add any other exports that the codebase needs
export const SorobanDataBuilder = class {};
export const TransactionBuilder = class {};
export const Operation = class {};
export const Asset = class {};
export const Keypair = class {};
export const Transaction = class {};
export const Memo = class {};
export const TimeoutInfinite = 0;
export const BASE_FEE = 100;