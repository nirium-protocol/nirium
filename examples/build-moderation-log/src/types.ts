export type ModerationAction =
  | "warn"
  | "mute"
  | "ban"
  | "message_removal"
  | "kick";

export interface ModerationInput {
  action: ModerationAction;
  reason: string;
  moderatorId: string;
  targetUserId: string;
  messageContent?: string;
  channelId?: string;
  serverId: string;
}

export interface ModerationStoreRecord {
  actionId: string;
  action: ModerationAction;
  reason: string;
  moderatorId: string;
  targetUserId: string;
  messageContent?: string;
  channelId?: string;
  serverId: string;
  salt: string;
  timestamp: string;
}

export interface AnchoredModerationPayload {
  actionId: string;
  action: ModerationAction;
  reason: string;
  moderatorIdHash: string;
  targetUserIdHash: string;
  messageContentHash?: string;
  channelId?: string;
  serverId: string;
  timestamp: string;
}

export interface ModerationReceipt {
  actionId: string;
  cid: string;
  sha256: string;
  signerKey: string;
  tag: string;
  anchoredAt: string;
  payload: AnchoredModerationPayload;
}

export interface CheckResult {
  valid: boolean;
  actionId: string;
  action: ModerationAction;
  reason: string;
  cid: string;
  signerKey: string;
  hashMatch: boolean;
  signerVerified?: boolean;
  error?: string;
}
