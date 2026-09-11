import WebSocket from 'ws';

export interface Signal {
  id?: string;
  signal_type: string;
  pair: string;
  timestamp?: string;
  data: Record<string, unknown>;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface ConnectionStatusInfo {
  status: ConnectionStatus;
  attempt?: number;
  delayMs?: number;
  error?: Error;
}

export interface ResilientSignalClientOptions {
  url: string;
  token?: string;
  onTokenRefresh?: () => Promise<string>;
  subscriptionId?: string;
  maxReconnectAttempts?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  pingIntervalMs?: number;
  dedupWindowMs?: number;
  WebSocketCtor?: any;
}

export class ResilientSignalClient {
  private url: string;
  private token: string | null;
  private onTokenRefresh?: () => Promise<string>;
  private subscriptionId?: string;

  private maxReconnectAttempts: number;
  private initialBackoffMs: number;
  private maxBackoffMs: number;
  private pingIntervalMs: number;
  private dedupWindowMs: number;
  private WebSocketCtor: any;

  private ws: WebSocket | null = null;
  private status: ConnectionStatus = 'disconnected';
  private reconnectAttempt = 0;
  private isIntentionallyClosed = false;

  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private seenSignals = new Map<string, number>();

  private signalCallbacks: Array<(signal: Signal) => void> = [];
  private statusCallbacks: Array<(info: ConnectionStatusInfo) => void> = [];
  private errorCallbacks: Array<(error: Error) => void> = [];

  constructor(options: ResilientSignalClientOptions) {
    this.url = options.url.replace(/\/$/, '');
    this.token = options.token || null;
    this.onTokenRefresh = options.onTokenRefresh;
    this.subscriptionId = options.subscriptionId;

    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 10;
    this.initialBackoffMs = options.initialBackoffMs ?? 1000;
    this.maxBackoffMs = options.maxBackoffMs ?? 30000;
    this.pingIntervalMs = options.pingIntervalMs ?? 15000;
    this.dedupWindowMs = options.dedupWindowMs ?? 60000;
    this.WebSocketCtor = options.WebSocketCtor || WebSocket;
  }

  public connect(): void {
    if (this.status === 'connected' || this.status === 'connecting') {
      return;
    }
    this.isIntentionallyClosed = false;
    this.initiateConnection();
  }

  private async initiateConnection(): Promise<void> {
    this.updateStatus(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');

    if (this.onTokenRefresh) {
      try {
        this.token = await this.onTokenRefresh();
      } catch (err: any) {
        this.notifyError(new Error(`Token refresh failed: ${err?.message || String(err)}`));
      }
    }

    try {
      const queryParams: string[] = [];
      if (this.token) {
        queryParams.push(`token=${encodeURIComponent(this.token)}`);
      }
      if (this.subscriptionId) {
        queryParams.push(`subscriptionId=${encodeURIComponent(this.subscriptionId)}`);
      }
      const fullUrl = queryParams.length > 0 ? `${this.url}?${queryParams.join('&')}` : this.url;

      const WsClass = this.WebSocketCtor;
      this.ws = new WsClass(fullUrl);
      // WebSocketCtor is typed `any` (it's either the global WebSocket or
      // the `ws` package's constructor, picked at runtime), so assigning
      // its result doesn't narrow `this.ws` past `WebSocket | null` for TS
      // -- non-null by construction, we just set it on the line above.
      const ws = this.ws!;

      ws.on('open', () => {
        this.reconnectAttempt = 0;
        this.updateStatus('connected');
        this.startHeartbeat();

        if (this.subscriptionId && this.ws?.readyState === WsClass.OPEN) {
          this.ws?.send(JSON.stringify({ type: 'subscribe', subscriptionId: this.subscriptionId }));
        }
      });

      ws.on('message', (data: any) => {
        this.handleMessage(data);
      });

      ws.on('close', (code: number, reason: string) => {
        this.stopHeartbeat();
        if (!this.isIntentionallyClosed) {
          this.scheduleReconnect();
        } else {
          this.updateStatus('disconnected');
        }
      });

      ws.on('error', (err: Error) => {
        this.notifyError(err);
      });

      ws.on('pong', () => {
        this.resetPongTimeout();
      });
    } catch (err: any) {
      this.notifyError(err instanceof Error ? err : new Error(String(err)));
      this.scheduleReconnect();
    }
  }

  private handleMessage(data: any): void {
    this.resetPongTimeout();

    try {
      const payloadStr = typeof data === 'string' ? data : data.toString();
      const message = JSON.parse(payloadStr);

      if (message.type === 'pong') {
        return;
      }

      if (message.type === 'signal' || message.signal_type || message.pair) {
        const signal = message as Signal;
        const dedupKey = signal.id || `${signal.signal_type}:${signal.pair}:${JSON.stringify(signal.data || {})}`;

        const now = Date.now();
        this.pruneDedupBuffer(now);

        if (this.seenSignals.has(dedupKey)) {
          return; // Suppress duplicate burst message
        }

        this.seenSignals.set(dedupKey, now);
        this.signalCallbacks.forEach((cb) => {
          try {
            cb(signal);
          } catch (e: any) {
            this.notifyError(e);
          }
        });
      }
    } catch (err: any) {
      // Ignore unparseable frames safely without unhandled rejections
    }
  }

  private scheduleReconnect(): void {
    if (this.isIntentionallyClosed) return;

    if (this.reconnectAttempt >= this.maxReconnectAttempts) {
      this.updateStatus('disconnected', {
        error: new Error(`Max reconnect attempts (${this.maxReconnectAttempts}) reached.`),
      });
      return;
    }

    this.reconnectAttempt++;
    const jitter = Math.random() * 500;
    const delayMs = Math.min(
      this.initialBackoffMs * Math.pow(2, this.reconnectAttempt - 1) + jitter,
      this.maxBackoffMs
    );

    this.updateStatus('reconnecting', { attempt: this.reconnectAttempt, delayMs });

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.initiateConnection();
    }, delayMs);
    if (this.reconnectTimer && typeof this.reconnectTimer.unref === 'function') {
      this.reconnectTimer.unref();
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === this.WebSocketCtor.OPEN) {
        try {
          if (typeof this.ws.ping === 'function') {
            this.ws.ping();
          } else {
            this.ws.send(JSON.stringify({ type: 'ping' }));
          }
        } catch {
          // Ignore send errors, timeout will handle disconnection
        }
        this.armPongTimeout();
      }
    }, this.pingIntervalMs);
    if (this.pingTimer && typeof this.pingTimer.unref === 'function') {
      this.pingTimer.unref();
    }
  }

  private armPongTimeout(): void {
    if (this.pongTimeoutTimer) clearTimeout(this.pongTimeoutTimer);
    this.pongTimeoutTimer = setTimeout(() => {
      // Missing heartbeat — terminate connection to force reconnect
      if (this.ws) {
        try {
          this.ws.terminate ? this.ws.terminate() : this.ws.close();
        } catch {
          // Ignore
        }
      }
    }, this.pingIntervalMs * 2);
    if (this.pongTimeoutTimer && typeof this.pongTimeoutTimer.unref === 'function') {
      this.pongTimeoutTimer.unref();
    }
  }

  private resetPongTimeout(): void {
    if (this.pongTimeoutTimer) {
      clearTimeout(this.pongTimeoutTimer);
      this.pongTimeoutTimer = null;
    }
  }

  private stopHeartbeat(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.pongTimeoutTimer) {
      clearTimeout(this.pongTimeoutTimer);
      this.pongTimeoutTimer = null;
    }
  }

  private pruneDedupBuffer(now: number): void {
    for (const [key, timestamp] of Array.from(this.seenSignals.entries())) {
      if (now - timestamp > this.dedupWindowMs) {
        this.seenSignals.delete(key);
      }
    }
  }

  private updateStatus(status: ConnectionStatus, extra?: { attempt?: number; delayMs?: number; error?: Error }): void {
    this.status = status;
    const info: ConnectionStatusInfo = { status, ...extra };
    this.statusCallbacks.forEach((cb) => {
      try {
        cb(info);
      } catch (e: any) {
        this.notifyError(e);
      }
    });
  }

  private notifyError(error: Error): void {
    this.errorCallbacks.forEach((cb) => {
      try {
        cb(error);
      } catch {
        // Prevent recursive errors
      }
    });
  }

  public onSignal(callback: (signal: Signal) => void): () => void {
    this.signalCallbacks.push(callback);
    return () => {
      this.signalCallbacks = this.signalCallbacks.filter((cb) => cb !== callback);
    };
  }

  public onStatus(callback: (info: ConnectionStatusInfo) => void): () => void {
    this.statusCallbacks.push(callback);
    return () => {
      this.statusCallbacks = this.statusCallbacks.filter((cb) => cb !== callback);
    };
  }

  public onError(callback: (error: Error) => void): () => void {
    this.errorCallbacks.push(callback);
    return () => {
      this.errorCallbacks = this.errorCallbacks.filter((cb) => cb !== callback);
    };
  }

  public getStatus(): ConnectionStatus {
    return this.status;
  }

  public close(): void {
    this.isIntentionallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    if (this.ws) {
      try {
        if (typeof this.ws.terminate === 'function') {
          this.ws.terminate();
        } else if (typeof this.ws.close === 'function') {
          this.ws.close();
        }
      } catch {
        // Ignore close errors
      }
      this.ws = null;
    }
    this.updateStatus('disconnected');
  }
}
