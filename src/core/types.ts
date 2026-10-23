/** All times are simulated integer milliseconds. No wall clock or network I/O. */
export interface Config {
  seed: number;
  messageCount: number;
  sendIntervalMs: number;
  delayMs: number;
  jitterMs: number;
  loss: number;
  duplicate: number;
  ack: boolean;
  retry: boolean;
  dedup: boolean;
  backoff: boolean;
  retryJitter: boolean;
  timeoutMs: number;
  maxAttempts: number;
  queueCapacity: number;
  serviceMs: number;
}

export interface MessageState {
  id: number;
  createdAt: number;
  attempts: number;
  deliveredAt: number | null;
  acknowledged: boolean;
  failed: boolean;
  applications: number;
}

export interface SimEvent {
  id: number;
  time: number;
  kind: string;
  messageId: number;
  attempt: number;
}

export interface TraceEntry extends SimEvent {
  detail: string;
}

export interface Flight {
  id: number;
  messageId: number;
  attempt: number;
  kind: "data" | "ack";
  start: number;
  end: number;
  duplicate: boolean;
}

export interface Sample {
  time: number;
  delivered: number;
  applied: number;
  latency: number | null;
  throughput: number;
}

export interface Metrics {
  /** DATA attempts, including packets rejected by the finite service queue. */
  sent: number;
  delivered: number;
  applied: number;
  duplicates: number;
  /** Lost or overflowing DATA + ACK packets. */
  dropped: number;
  retries: number;
  acknowledged: number;
  failed: number;
  meanLatency: number | null;
  /** Unique first deliveries / elapsed simulated seconds. */
  throughput: number;
}

export interface Snapshot {
  now: number;
  status: "ready" | "active" | "complete" | "limited";
  config: Config;
  metrics: Metrics;
  messages: MessageState[];
  pending: SimEvent[];
  trace: TraceEntry[];
  series: Sample[];
  inFlight: Flight[];
  warning: string | null;
}

export interface Scenario {
  id: string;
  name: { en: string; ru: string };
  description: { en: string; ru: string };
  config: Config;
}
