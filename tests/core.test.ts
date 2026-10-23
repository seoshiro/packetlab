import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  LIMITS,
  SCENARIOS,
  Simulation,
  exportReplay,
  importReplay,
  validateConfig,
} from "../src/core";
import type { Config, Snapshot } from "../src/core";

const config = (overrides: Partial<Config> = {}): Config => ({
  ...DEFAULT_CONFIG,
  seed: 42,
  messageCount: 1,
  sendIntervalMs: 100,
  serviceMs: 10,
  delayMs: 100,
  jitterMs: 0,
  loss: 0,
  duplicate: 0,
  timeoutMs: 500,
  ...overrides,
});

function run(overrides: Partial<Config> = {}): Snapshot {
  return new Simulation(config(overrides)).runToEnd();
}

describe("analytical model checks", () => {
  it("matches one-way service + propagation and unique-delivery throughput", () => {
    const result = run();
    expect(result.status).toBe("complete");
    expect(result.now).toBe(110);
    expect(result.metrics).toMatchObject({
      sent: 1,
      delivered: 1,
      applied: 1,
      retries: 0,
      dropped: 0,
      failed: 0,
      meanLatency: 110,
    });
    expect(result.metrics.throughput).toBeCloseTo(1000 / 110);
    expect(result.pending).toEqual([]);
    expect(result.inFlight).toEqual([]);
  });

  it("has null latency before any first delivery, never synthetic zero latency", () => {
    const simulation = new Simulation(config());
    expect(simulation.getSnapshot().metrics.meanLatency).toBeNull();
    expect(simulation.step().metrics.meanLatency).toBeNull();
    expect(run({ loss: 1 }).metrics.meanLatency).toBeNull();
  });

  it("matches round trip timing, and ACK removes future retry deadlines", () => {
    const result = run({ ack: true, retry: true });
    expect(result.now).toBe(220);
    expect(result.metrics).toMatchObject({
      sent: 1,
      delivered: 1,
      acknowledged: 1,
      retries: 0,
      failed: 0,
    });
    expect(result.trace.filter((entry) => entry.kind === "timeout")).toEqual(
      [],
    );
  });

  it("treats an ACK at exactly the timeout using insertion ID order", () => {
    const simulation = new Simulation(
      config({ ack: true, retry: true, delayMs: 10, timeoutMs: 40 }),
    );
    const atDeadline = simulation.advanceTo(40);
    expect(atDeadline.metrics).toMatchObject({
      sent: 2,
      retries: 1,
      acknowledged: 1,
    });
    const ties = atDeadline.trace.filter((entry) => entry.time === 40);
    expect(ties.findIndex((entry) => entry.kind === "timeout")).toBeLessThan(
      ties.findIndex((entry) => entry.kind === "ack_receive"),
    );
    expect(atDeadline.pending.some((event) => event.kind === "timeout")).toBe(
      false,
    );
    const result = simulation.runToEnd();
    expect(result.messages[0].attempts).toBe(2);
    expect(result.metrics).toMatchObject({
      delivered: 1,
      applied: 2,
      duplicates: 1,
    });
  });

  it("allows old ACKs to cancel retries but does not retract DATA already sent", () => {
    const result = run({ ack: true, retry: true, timeoutMs: 150, dedup: true });
    expect(result.metrics).toMatchObject({
      sent: 2,
      retries: 1,
      delivered: 1,
      applied: 1,
      duplicates: 1,
      acknowledged: 1,
    });
    expect(
      result.trace.some(
        (entry) => entry.kind === "ack_receive" && entry.attempt === 1,
      ),
    ).toBe(true);
    expect(
      result.trace.some(
        (entry) => entry.kind === "dedup" && entry.attempt === 2,
      ),
    ).toBe(true);
  });

  it("drains a late ACK after exhaustion without falsely marking sender failure", () => {
    const result = run({
      ack: true,
      retry: true,
      timeoutMs: 20,
      maxAttempts: 1,
    });
    expect(result.trace.some((entry) => entry.kind === "exhausted")).toBe(true);
    expect(result.metrics).toMatchObject({
      sent: 1,
      failed: 0,
      acknowledged: 1,
      delivered: 1,
    });
  });

  it("has separate FIFO queues in opposite directions", () => {
    const result = run({
      ack: true,
      messageCount: 4,
      sendIntervalMs: 10,
      delayMs: 10,
      queueCapacity: 1,
    });
    // At 10 ms, initial send #2 precedes #1 departure and overflows. At 20 ms,
    // DATA #3 and ACK #1 coexist because their service queues are independent.
    expect(
      result.trace.some(
        (entry) =>
          entry.kind === "queue" && entry.messageId === 3 && entry.time === 20,
      ),
    ).toBe(true);
    expect(
      result.trace.some(
        (entry) =>
          entry.kind === "ack_send" &&
          entry.messageId === 1 &&
          entry.time === 20,
      ),
    ).toBe(true);
    expect(result.metrics.acknowledged).toBe(result.metrics.delivered);
    expect(result.metrics.dropped).toBe(2);
  });

  it("accounts exactly for an overflowing simultaneous burst", () => {
    const result = run({
      messageCount: 10,
      sendIntervalMs: 0,
      queueCapacity: 2,
      delayMs: 10,
    });
    expect(result.metrics).toMatchObject({
      sent: 10,
      delivered: 2,
      applied: 2,
      dropped: 8,
      failed: 8,
    });
    expect(
      result.messages
        .filter((message) => message.deliveredAt !== null)
        .map((message) => message.id),
    ).toEqual([1, 2]);
    expect(result.now).toBe(30);
  });

  it("delivers duplicate DATA twice without dedup and applies once with dedup", () => {
    const shared = { messageCount: 3, duplicate: 1 };
    expect(run({ ...shared, dedup: false }).metrics).toMatchObject({
      delivered: 3,
      applied: 6,
      duplicates: 3,
    });
    expect(run({ ...shared, dedup: true }).metrics).toMatchObject({
      delivered: 3,
      applied: 3,
      duplicates: 3,
    });
  });

  it("ACKs repeated DATA even when its side effect is suppressed", () => {
    const result = run({
      ack: true,
      retry: true,
      dedup: true,
      duplicate: 1,
      timeoutMs: 500,
    });
    expect(result.metrics).toMatchObject({
      delivered: 1,
      applied: 1,
      duplicates: 1,
      acknowledged: 1,
      sent: 1,
    });
    expect(
      result.trace.filter((entry) => entry.kind === "ack_send"),
    ).toHaveLength(2);
    expect(
      result.trace.filter((entry) => entry.kind === "duplicate"),
    ).toHaveLength(3); // DATA and each of two ACKs
  });

  it("counts DATA and ACK loss and stops after the finite attempt budget", () => {
    const result = run({
      ack: true,
      retry: true,
      loss: 1,
      messageCount: 3,
      maxAttempts: 4,
      timeoutMs: 100,
    });
    expect(result.status).toBe("complete");
    expect(result.metrics).toMatchObject({
      sent: 12,
      retries: 9,
      delivered: 0,
      acknowledged: 0,
      dropped: 12,
      failed: 3,
    });
    expect(result.messages.every((message) => message.attempts === 4)).toBe(
      true,
    );
    expect(result.pending).toEqual([]);
    expect(result.metrics.meanLatency).toBeNull();
  });

  it("distinguishes receiver delivery from sender confirmation when the ACK is lost", () => {
    const result = new Simulation({
      ...DEFAULT_CONFIG,
      seed: 3,
      messageCount: 1,
      ack: true,
      retry: false,
      loss: 0.5,
      duplicate: 0,
    }).runToEnd();
    expect(result.metrics).toMatchObject({
      sent: 1,
      delivered: 1,
      applied: 1,
      acknowledged: 0,
      failed: 1,
      dropped: 1,
    });
    expect(
      result.trace.find((entry) => entry.kind === "drop_loss")?.detail,
    ).toContain("ACK");
  });

  it("retry without ACK uses the entire budget even after receiver delivery", () => {
    const result = run({
      ack: false,
      retry: true,
      maxAttempts: 3,
      dedup: true,
    });
    expect(result.metrics).toMatchObject({
      sent: 3,
      retries: 2,
      delivered: 1,
      applied: 1,
      acknowledged: 0,
      failed: 0,
    });
  });

  it("uses exponential capped backoff and equal jitter intervals", () => {
    const result = run({
      retry: true,
      ack: true,
      loss: 1,
      backoff: true,
      retryJitter: false,
      maxAttempts: 5,
      timeoutMs: 100,
    });
    expect(
      result.trace
        .filter((entry) => entry.kind === "send" || entry.kind === "retry")
        .map((entry) => entry.time),
    ).toEqual([0, 100, 300, 700, 1500]);
    const jittered = run({
      retry: true,
      ack: true,
      loss: 1,
      backoff: true,
      retryJitter: true,
      maxAttempts: 5,
      timeoutMs: 100,
    });
    const sendTimes = jittered.trace
      .filter((entry) => entry.kind === "send" || entry.kind === "retry")
      .map((entry) => entry.time);
    for (let index = 1; index < sendTimes.length; index += 1) {
      const rto = 100 * 2 ** (index - 1);
      expect(sendTimes[index] - sendTimes[index - 1]).toBeGreaterThanOrEqual(
        rto / 2,
      );
      expect(sendTimes[index] - sendTimes[index - 1]).toBeLessThanOrEqual(rto);
    }
  });
});

describe("determinism, invariants, bounds", () => {
  it("keeps all four educational presets reproducible with explicit expected outcomes", () => {
    const expected = [
      { sent: 16, delivered: 11, applied: 12, retries: 0, dropped: 5 },
      { sent: 113, delivered: 7, applied: 19, retries: 97, dropped: 96 },
      { sent: 69, delivered: 16, applied: 23, retries: 53, dropped: 49 },
      { sent: 34, delivered: 12, applied: 12, retries: 22, dropped: 11 },
    ];
    SCENARIOS.forEach((scenario, index) => {
      const result = new Simulation(scenario.config).runToEnd();
      expect(result.status).toBe("complete");
      expect(result.metrics).toMatchObject(expected[index]);
    });
    const dedup = SCENARIOS.find((scenario) => scenario.id === "dedup")!;
    const withoutDedup = new Simulation({
      ...dedup.config,
      dedup: false,
    }).runToEnd();
    const withDedup = new Simulation(dedup.config).runToEnd();
    expect(withoutDedup.metrics.applied).toBe(50);
    expect(withoutDedup.metrics.delivered).toBe(withDedup.metrics.delivered);
    expect(withoutDedup.metrics.sent).toBe(withDedup.metrics.sent);
    expect(withoutDedup.metrics.dropped).toBe(withDedup.metrics.dropped);
  });

  it("gives the exact same trace and metrics after replay and different frame cadences", () => {
    for (const scenario of SCENARIOS) {
      const expected = new Simulation(scenario.config).runToEnd();
      const stepped = new Simulation(
        importReplay(exportReplay(scenario.config)),
      );
      while (
        stepped.getSnapshot().status !== "complete" &&
        stepped.getSnapshot().status !== "limited"
      )
        stepped.step();
      expect(stepped.getSnapshot()).toEqual(expected);
      const framed = new Simulation(scenario.config);
      let frame = 0;
      while (
        framed.getSnapshot().status !== "complete" &&
        framed.getSnapshot().status !== "limited"
      ) {
        frame += 37;
        framed.advanceTo(frame);
      }
      expect(framed.getSnapshot()).toEqual(expected);
    }
  });

  it("has immutable snapshots and captures a copy of its validated configuration", () => {
    const initial = config();
    const simulation = new Simulation(initial);
    initial.loss = 1;
    const snapshot = simulation.getSnapshot();
    snapshot.config.loss = 1;
    snapshot.messages[0].attempts = 99;
    snapshot.pending[0].time = 999999;
    snapshot.series[0].delivered = 999;
    snapshot.trace.push({
      id: 99,
      time: 0,
      kind: "bad",
      messageId: 1,
      attempt: 1,
      detail: "bad",
    });
    expect(simulation.runToEnd()).toEqual(run());
  });

  it("different seeds produce different outcomes, including seed zero", () => {
    const a = run({ seed: 0, messageCount: 20, loss: 0.4, jitterMs: 90 });
    const b = run({ seed: 1, messageCount: 20, loss: 0.4, jitterMs: 90 });
    expect(a.trace).not.toEqual(b.trace);
    expect(new Simulation(a.config).runToEnd()).toEqual(a);
  });

  it("jitter can reorder arrivals while every event remains ordered by time and ID", () => {
    const simulation = new Simulation(
      config({
        seed: 8,
        messageCount: 20,
        sendIntervalMs: 10,
        delayMs: 100,
        jitterMs: 90,
        queueCapacity: 64,
      }),
    );
    let previous = { time: -1, id: -1 };
    while (simulation.getSnapshot().status !== "complete") {
      const next = simulation.getSnapshot().pending[0];
      expect(
        next.time > previous.time ||
          (next.time === previous.time && next.id > previous.id),
      ).toBe(true);
      previous = next;
      simulation.step();
    }
    const deliveredIds = simulation
      .getSnapshot()
      .trace.filter((entry) => entry.kind === "deliver")
      .map((entry) => entry.messageId);
    expect(deliveredIds).not.toEqual([...deliveredIds].sort((a, b) => a - b));
  });

  it("enforces finite storage and time for extreme allowed inputs", () => {
    const simulation = new Simulation(
      config({
        seed: 0,
        messageCount: 40,
        sendIntervalMs: 2000,
        ack: true,
        retry: true,
        loss: 1,
        maxAttempts: 12,
        timeoutMs: 5000,
        backoff: true,
      }),
    );
    const result = simulation.runToEnd();
    expect(result.status).toBe("limited");
    expect(result.warning).toContain("horizon");
    expect(result.now).toBe(LIMITS.maxTimeMs);
    expect(result.pending.length).toBeLessThanOrEqual(LIMITS.maxPending);
    expect(result.trace.length).toBeLessThanOrEqual(LIMITS.maxTrace);
    expect(result.series.length).toBeLessThanOrEqual(LIMITS.maxSamples);
    expect(result.metrics.failed).toBe(0); // Unresolved at a safety stop, not proven failures.
    expect(simulation.step()).toEqual(result);
  });

  it("preserves accounting and bounded state across many reproducible seeds", () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const simulation = new Simulation(
        config({
          seed,
          messageCount: 12,
          sendIntervalMs: (seed % 4) * 15,
          loss: (seed % 5) / 5,
          duplicate: (seed % 4) / 3,
          ack: true,
          retry: true,
          dedup: true,
          backoff: seed % 2 === 0,
          retryJitter: true,
          queueCapacity: 1 + (seed % 6),
          timeoutMs: 80,
          maxAttempts: 7,
          jitterMs: 90,
        }),
      );
      let previousDelivered = 0;
      let previousTime = 0;
      let steps = 0;
      while (
        simulation.getSnapshot().status !== "complete" &&
        simulation.getSnapshot().status !== "limited"
      ) {
        const snapshot = simulation.step();
        expect(snapshot.now).toBeGreaterThanOrEqual(previousTime);
        expect(snapshot.metrics.delivered).toBeGreaterThanOrEqual(
          previousDelivered,
        );
        expect(snapshot.metrics.applied).toBe(snapshot.metrics.delivered);
        expect(snapshot.metrics.delivered).toBeLessThanOrEqual(
          snapshot.config.messageCount,
        );
        expect(snapshot.metrics.acknowledged).toBeLessThanOrEqual(
          snapshot.metrics.delivered,
        );
        expect(snapshot.metrics.retries).toBe(
          snapshot.metrics.sent -
            snapshot.messages.filter((message) => message.attempts > 0).length,
        );
        expect(snapshot.metrics.sent).toBeLessThanOrEqual(12 * 7);
        expect(snapshot.pending.length).toBeLessThanOrEqual(LIMITS.maxPending);
        expect(snapshot.trace.length).toBeLessThanOrEqual(LIMITS.maxTrace);
        expect(snapshot.series.length).toBeLessThanOrEqual(LIMITS.maxSamples);
        expect(
          snapshot.inFlight.every(
            (flight) =>
              flight.start <= snapshot.now && flight.end >= snapshot.now,
          ),
        ).toBe(true);
        for (let index = 1; index < snapshot.pending.length; index += 1) {
          const previous = snapshot.pending[index - 1];
          const next = snapshot.pending[index];
          expect(
            next.time > previous.time ||
              (next.time === previous.time && next.id > previous.id),
          ).toBe(true);
        }
        previousDelivered = snapshot.metrics.delivered;
        previousTime = snapshot.now;
        steps += 1;
        expect(steps).toBeLessThanOrEqual(LIMITS.maxEvents);
      }
      const end = simulation.getSnapshot();
      expect(end.status).toBe("complete");
      expect(end.metrics.failed + end.metrics.acknowledged).toBe(12);
    }
  });

  it("rejects time travel and non-finite advance requests", () => {
    const simulation = new Simulation(config());
    simulation.advanceTo(20);
    for (const invalid of [-1, 10, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => simulation.advanceTo(invalid)).toThrow();
    }
    expect(simulation.getSnapshot().now).toBe(20);
  });

  it("terminal steps are idempotent and do not change elapsed time", () => {
    const simulation = new Simulation(config());
    const final = simulation.runToEnd();
    expect(simulation.step()).toEqual(final);
    expect(simulation.advanceTo(10000)).toEqual(final);
  });
});

describe("configuration and replay boundaries", () => {
  it("round trips every preset through a versioned replay", () => {
    for (const scenario of SCENARIOS) {
      const replay = exportReplay(scenario.config);
      expect(JSON.parse(replay).schemaVersion).toBe(1);
      expect(importReplay(replay)).toEqual(scenario.config);
    }
  });

  it.each([
    ["seed", -1],
    ["seed", 4294967296],
    ["messageCount", 0],
    ["messageCount", 41],
    ["messageCount", 1.5],
    ["sendIntervalMs", -1],
    ["sendIntervalMs", 2001],
    ["delayMs", 9],
    ["delayMs", 2001],
    ["jitterMs", -1],
    ["jitterMs", 1001],
    ["loss", -0.01],
    ["loss", 1.01],
    ["duplicate", 1.01],
    ["timeoutMs", 19],
    ["timeoutMs", 5001],
    ["maxAttempts", 0],
    ["maxAttempts", 13],
    ["queueCapacity", 0],
    ["queueCapacity", 65],
    ["serviceMs", 9],
    ["serviceMs", 501],
    ["loss", Number.NaN],
    ["duplicate", Number.POSITIVE_INFINITY],
    ["ack", "false"],
    ["retry", 1],
    ["dedup", null],
    ["seed", "42"],
  ])("rejects invalid %s=%s without coercion", (key, value) => {
    expect(() => validateConfig({ ...config(), [key]: value })).toThrow();
  });

  it("rejects unknown, missing, inherited, array and prototype fields", () => {
    expect(() => validateConfig({ ...config(), extra: 1 })).toThrow();
    const incomplete: Partial<Config> = config();
    delete incomplete.ack;
    expect(() => validateConfig(incomplete)).toThrow();
    expect(() => validateConfig(Object.create(config()))).toThrow();
    expect(() => validateConfig([])).toThrow();
    expect(() => validateConfig(null)).toThrow();
    expect(() =>
      validateConfig({ ...config(), [Symbol("hidden")]: true }),
    ).toThrow();
    expect(() =>
      validateConfig(
        JSON.parse(`{"__proto__":{},${JSON.stringify(config()).slice(1)}`),
      ),
    ).toThrow();
  });

  it("rejects malformed, oversized and incompatible replay envelopes", () => {
    for (const invalid of [
      "",
      "not json",
      "null",
      "[]",
      "{}",
      JSON.stringify({ schemaVersion: 2, config: config() }),
      JSON.stringify({ schemaVersion: "1", config: config() }),
      JSON.stringify({ schemaVersion: 1, config: config(), payload: "extra" }),
      " ".repeat(LIMITS.maxReplayLength + 1),
    ]) {
      expect(() => importReplay(invalid)).toThrow();
    }
  });

  it("accepts every range boundary and all toggle combinations", () => {
    expect(
      validateConfig(
        config({
          seed: 0,
          messageCount: 1,
          sendIntervalMs: 0,
          delayMs: 10,
          jitterMs: 0,
          loss: 0,
          duplicate: 0,
          timeoutMs: 20,
          maxAttempts: 1,
          queueCapacity: 1,
          serviceMs: 10,
        }),
      ),
    ).toBeDefined();
    expect(
      validateConfig(
        config({
          seed: 4294967295,
          messageCount: 40,
          sendIntervalMs: 2000,
          delayMs: 2000,
          jitterMs: 1000,
          loss: 1,
          duplicate: 1,
          timeoutMs: 5000,
          maxAttempts: 12,
          queueCapacity: 64,
          serviceMs: 500,
        }),
      ),
    ).toBeDefined();
    for (let mask = 0; mask < 32; mask += 1) {
      expect(
        validateConfig(
          config({
            ack: Boolean(mask & 1),
            retry: Boolean(mask & 2),
            dedup: Boolean(mask & 4),
            backoff: Boolean(mask & 8),
            retryJitter: Boolean(mask & 16),
          }),
        ),
      ).toBeDefined();
    }
  });
});
