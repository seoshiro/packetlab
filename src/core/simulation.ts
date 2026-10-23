import { LIMITS, validateConfig } from "./config";
import type {
  Config,
  Flight,
  MessageState,
  Metrics,
  Sample,
  SimEvent,
  Snapshot,
  TraceEntry,
} from "./types";

type Packet = {
  id: number;
  kind: "data" | "ack";
  messageId: number;
  attempt: number;
  duplicate: boolean;
};
type InternalEvent = SimEvent & { packet?: Packet; flightId?: number };
type Link = { queue: Packet[]; freeAt: number };

function compareEvents(a: SimEvent, b: SimEvent): number {
  return a.time - b.time || a.id - b.id;
}

/** Mulberry32: fixed uint32 arithmetic; seed=0 is a valid deterministic stream. */
function randomStream(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Finite, single sender/receiver discrete-event model. Each direction has its own
 * bounded FIFO service queue. Propagation happens after service and may reorder.
 * Randomness is consumed only by model events, never by rendering or stepping.
 */
export class Simulation {
  private readonly config: Config;
  private readonly random: () => number;
  private now = 0;
  private status: Snapshot["status"] = "ready";
  private warning: string | null = null;
  private eventId = 0;
  private traceId = 0;
  private packetId = 0;
  private flightId = 0;
  private processed = 0;
  private pending: InternalEvent[] = [];
  private readonly trace: TraceEntry[] = [];
  private readonly series: Sample[] = [];
  private readonly messages: MessageState[];
  private inFlight: Flight[] = [];
  private readonly links: Record<Packet["kind"], Link> = {
    data: { queue: [], freeAt: 0 },
    ack: { queue: [], freeAt: 0 },
  };
  private sent = 0;
  private dropped = 0;
  private retries = 0;
  private duplicates = 0;

  constructor(input: Config) {
    this.config = validateConfig(input);
    this.random = randomStream(this.config.seed);
    this.messages = Array.from(
      { length: this.config.messageCount },
      (_, index) => ({
        id: index + 1,
        createdAt: index * this.config.sendIntervalMs,
        attempts: 0,
        deliveredAt: null,
        acknowledged: false,
        failed: false,
        applications: 0,
      }),
    );
    for (const message of this.messages)
      this.schedule(message.createdAt, "send", message.id, 1);
    this.sample();
  }

  getSnapshot(): Snapshot {
    return {
      now: this.now,
      status: this.status,
      config: { ...this.config },
      metrics: this.metrics(),
      messages: this.messages.map((message) => ({ ...message })),
      pending: this.pending.map(({ id, time, kind, messageId, attempt }) => ({
        id,
        time,
        kind,
        messageId,
        attempt,
      })),
      trace: this.trace.map((entry) => ({ ...entry })),
      series: this.series.map((entry) => ({ ...entry })),
      inFlight: this.inFlight.map((flight) => ({ ...flight })),
      warning: this.warning,
    };
  }

  /** Process exactly one event, including deterministic no-op timeout events. */
  step(): Snapshot {
    this.stepInternal();
    return this.getSnapshot();
  }

  /** Run all events at/before time; same result independent of frame cadence. */
  advanceTo(timeMs: number): Snapshot {
    if (!Number.isFinite(timeMs) || timeMs < this.now || timeMs < 0) {
      throw new Error(
        "Simulation time must be finite and cannot move backwards.",
      );
    }
    if (this.terminal()) return this.getSnapshot();
    while (
      !this.terminal() &&
      this.pending.length > 0 &&
      this.pending[0].time <= timeMs
    ) {
      this.stepInternal();
    }
    if (!this.terminal()) {
      this.now = Math.min(Math.floor(timeMs), LIMITS.maxTimeMs);
      this.status = "active";
      if (timeMs >= LIMITS.maxTimeMs)
        this.limit("Simulated time horizon reached.");
    }
    return this.getSnapshot();
  }

  runToEnd(): Snapshot {
    while (!this.terminal()) this.stepInternal();
    return this.getSnapshot();
  }

  private terminal(): boolean {
    return this.status === "complete" || this.status === "limited";
  }

  private schedule(
    time: number,
    kind: string,
    messageId: number,
    attempt: number,
    extra: Partial<InternalEvent> = {},
  ): void {
    if (this.terminal()) return;
    if (this.pending.length >= LIMITS.maxPending) {
      this.limit("Pending event capacity reached.");
      return;
    }
    this.pending.push({
      id: ++this.eventId,
      time,
      kind,
      messageId,
      attempt,
      ...extra,
    });
    this.pending.sort(compareEvents);
  }

  private stepInternal(): void {
    if (this.terminal()) return;
    const event = this.pending[0];
    if (!event) {
      this.complete();
      return;
    }
    if (event.time > LIMITS.maxTimeMs) {
      this.now = LIMITS.maxTimeMs;
      this.limit("Simulated time horizon reached.");
      return;
    }
    if (this.processed >= LIMITS.maxEvents) {
      this.limit("Processed event capacity reached.");
      return;
    }
    this.pending.shift();
    this.now = event.time;
    this.status = "active";
    this.processed += 1;
    const message = this.messages[event.messageId - 1];
    switch (event.kind) {
      case "send":
        this.send(message, event.attempt);
        break;
      case "depart_data":
      case "depart_ack":
        if (event.packet) this.depart(event.packet);
        break;
      case "receive_data":
        this.inFlight = this.inFlight.filter(
          (flight) => flight.id !== event.flightId,
        );
        this.receiveData(message, event.attempt);
        break;
      case "receive_ack":
        this.inFlight = this.inFlight.filter(
          (flight) => flight.id !== event.flightId,
        );
        this.receiveAck(message, event.attempt);
        break;
      case "timeout":
        this.timeout(message, event.attempt);
        break;
    }
    if (!this.terminal() && this.pending.length === 0) this.complete();
    this.sample();
  }

  private send(message: MessageState, attempt: number): void {
    if (message.acknowledged) return;
    message.attempts = attempt;
    this.sent += 1;
    if (attempt > 1) this.retries += 1;
    this.log(
      attempt === 1 ? "send" : "retry",
      message.id,
      attempt,
      attempt === 1
        ? "Sender creates DATA with a stable message ID."
        : "No ACK has arrived; sender retries the same message ID.",
    );
    this.enqueue({
      id: ++this.packetId,
      kind: "data",
      messageId: message.id,
      attempt,
      duplicate: false,
    });
    if (this.config.retry) {
      const base =
        this.config.timeoutMs * (this.config.backoff ? 2 ** (attempt - 1) : 1);
      const capped = Math.min(base, LIMITS.maxRetryDelayMs);
      const wait = this.config.retryJitter
        ? Math.max(1, Math.round(capped * (0.5 + this.random() * 0.5)))
        : capped;
      this.schedule(this.now + wait, "timeout", message.id, attempt);
    }
  }

  private timeout(message: MessageState, attempt: number): void {
    if (message.acknowledged || message.attempts !== attempt) return;
    this.log(
      "timeout",
      message.id,
      attempt,
      "The sender deadline expired before an ACK arrived.",
    );
    if (attempt < this.config.maxAttempts) {
      this.send(message, attempt + 1);
    } else {
      this.log(
        "exhausted",
        message.id,
        attempt,
        "Attempt budget exhausted; in-flight DATA and ACK packets may still arrive.",
      );
    }
  }

  private enqueue(packet: Packet): void {
    const link = this.links[packet.kind];
    if (link.queue.length >= this.config.queueCapacity) {
      this.dropped += 1;
      this.log(
        "drop_overflow",
        packet.messageId,
        packet.attempt,
        `${packet.kind.toUpperCase()} queue is full; packet discarded before service.`,
      );
      return;
    }
    const departure = Math.max(this.now, link.freeAt) + this.config.serviceMs;
    link.freeAt = departure;
    link.queue.push(packet);
    this.log(
      "queue",
      packet.messageId,
      packet.attempt,
      `${packet.kind.toUpperCase()} joins its directional FIFO; service completes at ${departure} ms.`,
    );
    this.schedule(
      departure,
      `depart_${packet.kind}`,
      packet.messageId,
      packet.attempt,
      { packet },
    );
  }

  private depart(packet: Packet): void {
    const link = this.links[packet.kind];
    link.queue = link.queue.filter((queued) => queued.id !== packet.id);
    if (this.random() < this.config.loss) {
      this.dropped += 1;
      this.log(
        "drop_loss",
        packet.messageId,
        packet.attempt,
        `${packet.kind.toUpperCase()} was lost after service; no arrival is scheduled.`,
      );
      return;
    }
    this.log(
      "transmit",
      packet.messageId,
      packet.attempt,
      `${packet.kind.toUpperCase()} survived loss and enters propagation.`,
    );
    this.fly(packet);
    if (this.random() < this.config.duplicate) {
      this.log(
        "duplicate",
        packet.messageId,
        packet.attempt,
        `Network made one extra ${packet.kind.toUpperCase()} copy with an independent propagation delay.`,
      );
      this.fly({ ...packet, id: ++this.packetId, duplicate: true });
    }
  }

  private fly(packet: Packet): void {
    const delay = Math.max(
      1,
      Math.round(
        this.config.delayMs + (this.random() * 2 - 1) * this.config.jitterMs,
      ),
    );
    const flight: Flight = {
      id: ++this.flightId,
      messageId: packet.messageId,
      attempt: packet.attempt,
      kind: packet.kind,
      start: this.now,
      end: this.now + delay,
      duplicate: packet.duplicate,
    };
    this.inFlight.push(flight);
    this.schedule(
      flight.end,
      `receive_${packet.kind}`,
      packet.messageId,
      packet.attempt,
      { flightId: flight.id },
    );
  }

  private receiveData(message: MessageState, attempt: number): void {
    const repeated = message.deliveredAt !== null;
    if (repeated) {
      this.duplicates += 1;
    } else {
      message.deliveredAt = this.now;
      this.log(
        "deliver",
        message.id,
        attempt,
        `First DATA delivery; end-to-end latency ${this.now - message.createdAt} simulated ms.`,
      );
    }
    if (repeated && this.config.dedup) {
      this.log(
        "dedup",
        message.id,
        attempt,
        "Receiver has seen this stable ID; suppress the side effect but still send ACK.",
      );
    } else {
      message.applications += 1;
      this.log(
        "apply",
        message.id,
        attempt,
        repeated
          ? "Repeated DATA applied again because receiver deduplication is disabled."
          : "Receiver applies the message side effect.",
      );
    }
    if (this.config.ack) {
      this.log(
        "ack_send",
        message.id,
        attempt,
        "Receiver queues ACK for this message ID, including repeated DATA.",
      );
      this.enqueue({
        id: ++this.packetId,
        kind: "ack",
        messageId: message.id,
        attempt,
        duplicate: false,
      });
    }
  }

  private receiveAck(message: MessageState, attempt: number): void {
    if (!message.acknowledged) {
      message.acknowledged = true;
      this.log(
        "ack_receive",
        message.id,
        attempt,
        "Sender receives ACK; cancel future retry deadlines for this message ID.",
      );
      this.pending = this.pending.filter(
        (event) =>
          !(event.messageId === message.id && event.kind === "timeout"),
      );
    }
  }

  private metrics(): Metrics {
    const deliveredMessages = this.messages.filter(
      (message) => message.deliveredAt !== null,
    );
    const delivered = deliveredMessages.length;
    return {
      sent: this.sent,
      delivered,
      applied: this.messages.reduce(
        (sum, message) => sum + message.applications,
        0,
      ),
      duplicates: this.duplicates,
      dropped: this.dropped,
      retries: this.retries,
      acknowledged: this.messages.filter((message) => message.acknowledged)
        .length,
      failed: this.messages.filter((message) => message.failed).length,
      meanLatency:
        delivered === 0
          ? null
          : deliveredMessages.reduce(
              (sum, message) =>
                sum + (message.deliveredAt ?? 0) - message.createdAt,
              0,
            ) / delivered,
      throughput: this.now > 0 ? (delivered * 1000) / this.now : 0,
    };
  }

  private sample(): void {
    const metrics = this.metrics();
    const next: Sample = {
      time: this.now,
      delivered: metrics.delivered,
      applied: metrics.applied,
      latency: metrics.meanLatency,
      throughput: metrics.throughput,
    };
    if (this.series.at(-1)?.time === this.now)
      this.series[this.series.length - 1] = next;
    else this.series.push(next);
    if (this.series.length > LIMITS.maxSamples) {
      // Preserve the entire time range by deterministic decimation, including endpoints.
      const retained = this.series.filter(
        (_, index) => index % 2 === 0 || index === this.series.length - 1,
      );
      this.series.splice(0, this.series.length, ...retained);
    }
  }

  private log(
    kind: string,
    messageId: number,
    attempt: number,
    detail: string,
  ): void {
    this.trace.push({
      id: ++this.traceId,
      time: this.now,
      kind,
      messageId,
      attempt,
      detail,
    });
    if (this.trace.length > LIMITS.maxTrace) this.trace.shift();
  }

  private complete(): void {
    this.status = "complete";
    for (const message of this.messages) {
      message.failed = this.config.ack
        ? !message.acknowledged
        : message.deliveredAt === null;
    }
    this.log(
      "complete",
      0,
      0,
      "All scheduled events drained. This is a finite simulation, not a real network measurement.",
    );
  }

  private limit(reason: string): void {
    this.status = "limited";
    this.warning = reason;
    this.log("limit", 0, 0, reason);
    this.sample();
  }
}
