import { expect, test } from "@playwright/test";
import {
  DEFAULT_CONFIG,
  Simulation,
  exportReplay,
  importReplay,
  validateConfig,
} from "../../src/core";

test.describe("independent model audit", () => {
  test("same configuration replays the complete result exactly", () => {
    const config = {
      ...DEFAULT_CONFIG,
      seed: 17019,
      messageCount: 12,
      loss: 0.32,
      duplicate: 0.45,
      ack: true,
      retry: true,
      dedup: true,
    };
    const first = new Simulation(config).runToEnd();
    const replayed = new Simulation(
      importReplay(exportReplay(config)),
    ).runToEnd();
    expect(replayed).toEqual(first);
  });

  test("perfect serialized link has analytically predictable delivery times", () => {
    const config = {
      ...DEFAULT_CONFIG,
      messageCount: 5,
      sendIntervalMs: 0,
      delayMs: 100,
      jitterMs: 0,
      loss: 0,
      duplicate: 0,
      ack: false,
      retry: false,
      serviceMs: 10,
      queueCapacity: 16,
    };
    const state = new Simulation(config).runToEnd();
    expect(state.status).toBe("complete");
    expect(state.messages.map((message) => message.deliveredAt)).toEqual([
      110, 120, 130, 140, 150,
    ]);
    expect(state.metrics.delivered).toBe(5);
    expect(state.metrics.applied).toBe(5);
    expect(state.metrics.meanLatency).toBe(130);
    expect(state.metrics.throughput).toBeCloseTo(5 / (state.now / 1000), 8);
  });

  test("total packet loss exhausts the finite retry budget", () => {
    const config = {
      ...DEFAULT_CONFIG,
      messageCount: 4,
      loss: 1,
      duplicate: 0,
      ack: true,
      retry: true,
      backoff: false,
      retryJitter: false,
      maxAttempts: 3,
      timeoutMs: 100,
      queueCapacity: 16,
      serviceMs: 10,
    };
    const state = new Simulation(config).runToEnd();
    expect(state.status).toBe("complete");
    expect(state.metrics.delivered).toBe(0);
    expect(state.metrics.meanLatency).toBeNull();
    expect(state.metrics.failed).toBe(4);
    expect(state.metrics.sent).toBe(12);
    expect(state.metrics.retries).toBe(8);
    expect(state.pending).toHaveLength(0);
  });

  test("ACK exactly at a deadline follows stable insertion order", () => {
    const config = {
      ...DEFAULT_CONFIG,
      messageCount: 1,
      sendIntervalMs: 0,
      delayMs: 100,
      jitterMs: 0,
      serviceMs: 10,
      loss: 0,
      duplicate: 0,
      ack: true,
      retry: true,
      dedup: true,
      backoff: false,
      retryJitter: false,
      maxAttempts: 3,
    };
    // RTT = 2 * (10 service + 100 propagation) = 220 ms.
    // The timeout was inserted at send time; the ACK receive event was inserted later.
    const tied = new Simulation({ ...config, timeoutMs: 220 }).runToEnd();
    expect(tied.metrics.retries).toBe(1);
    expect(tied.metrics.acknowledged).toBe(1);
    expect(tied.metrics.applied).toBe(1);
    expect(tied.metrics.failed).toBe(0);
    const ackFirst = new Simulation({ ...config, timeoutMs: 221 }).runToEnd();
    expect(ackFirst.metrics.retries).toBe(0);
    expect(ackFirst.now).toBe(220);
    expect(ackFirst.pending).toHaveLength(0);
  });

  test("a full directional FIFO visibly rejects excess simultaneous sends", () => {
    const config = {
      ...DEFAULT_CONFIG,
      messageCount: 3,
      sendIntervalMs: 0,
      delayMs: 100,
      jitterMs: 0,
      serviceMs: 10,
      loss: 0,
      duplicate: 0,
      ack: false,
      retry: false,
      queueCapacity: 1,
    };
    const state = new Simulation(config).runToEnd();
    expect(state.metrics.sent).toBe(3);
    expect(state.metrics.dropped).toBe(2);
    expect(state.metrics.delivered).toBe(1);
    expect(state.metrics.failed).toBe(2);
    expect(
      state.trace.filter((event) => event.kind === "drop_overflow"),
    ).toHaveLength(2);
  });

  test("dedup guarantees one receiver side effect per unique message", () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const config = {
        ...DEFAULT_CONFIG,
        seed,
        messageCount: 8,
        loss: 0.25,
        duplicate: 1,
        ack: true,
        retry: true,
        dedup: true,
        maxAttempts: 5,
      };
      const state = new Simulation(config).runToEnd();
      expect(state.metrics.applied, `seed ${seed}`).toBe(
        state.metrics.delivered,
      );
      expect(state.metrics.delivered).toBeLessThanOrEqual(config.messageCount);
      expect(state.metrics.applied).toBe(
        state.messages.reduce((sum, message) => sum + message.applications, 0),
      );
      for (const message of state.messages) {
        expect(message.applications).toBeLessThanOrEqual(1);
        if (message.deliveredAt !== null)
          expect(message.deliveredAt).toBeGreaterThanOrEqual(message.createdAt);
      }
    }
  });

  test("stepping preserves event ordering and finite state", () => {
    const config = {
      ...DEFAULT_CONFIG,
      seed: 72,
      messageCount: 20,
      sendIntervalMs: 0,
      loss: 0.3,
      duplicate: 1,
      ack: true,
      retry: true,
      queueCapacity: 2,
    };
    const simulation = new Simulation(config);
    let snapshot = simulation.getSnapshot();
    let lastTime = 0;
    let steps = 0;
    while (
      snapshot.status !== "complete" &&
      snapshot.status !== "limited" &&
      steps < 20_001
    ) {
      snapshot = simulation.step();
      expect(snapshot.now).toBeGreaterThanOrEqual(lastTime);
      lastTime = snapshot.now;
      for (let index = 1; index < snapshot.pending.length; index += 1) {
        const earlier = snapshot.pending[index - 1];
        const later = snapshot.pending[index];
        expect(
          later.time > earlier.time ||
            (later.time === earlier.time && later.id > earlier.id),
        ).toBeTruthy();
      }
      expect(snapshot.pending.length).toBeLessThanOrEqual(4096);
      expect(snapshot.trace.length).toBeLessThanOrEqual(512);
      expect(snapshot.series.length).toBeLessThanOrEqual(256);
      steps += 1;
    }
    expect(steps).toBeLessThan(20_001);
    expect(snapshot.status).toBe("complete");
    expect(snapshot.metrics.dropped).toBeGreaterThan(0);
    expect(simulation.step()).toEqual(snapshot);
  });

  test("snapshots cannot mutate simulation internals", () => {
    const simulation = new Simulation(DEFAULT_CONFIG);
    const before = simulation.getSnapshot();
    const expected = new Simulation(DEFAULT_CONFIG).getSnapshot();
    before.config.seed = 999;
    before.messages[0].attempts = 999;
    before.pending.length = 0;
    before.metrics.sent = 999;
    expect(simulation.getSnapshot()).toEqual(expected);
  });

  test("strict replay rejects malformed, unknown and out-of-range input", () => {
    expect(() => importReplay("{")).toThrow();
    expect(() => importReplay("x".repeat(8193))).toThrow();
    const envelope = JSON.parse(exportReplay(DEFAULT_CONFIG)) as Record<
      string,
      unknown
    >;
    expect(() =>
      importReplay(JSON.stringify({ ...envelope, schemaVersion: 99 })),
    ).toThrow();
    expect(() =>
      importReplay(JSON.stringify({ ...envelope, surprise: true })),
    ).toThrow();
    expect(() =>
      validateConfig({ ...DEFAULT_CONFIG, seed: Number.NaN }),
    ).toThrow();
    expect(() =>
      validateConfig({ ...DEFAULT_CONFIG, delayMs: Infinity }),
    ).toThrow();
    expect(() => validateConfig({ ...DEFAULT_CONFIG, loss: -0.01 })).toThrow();
    expect(() =>
      validateConfig({ ...DEFAULT_CONFIG, duplicate: 1.01 }),
    ).toThrow();
    expect(() =>
      validateConfig({ ...DEFAULT_CONFIG, messageCount: 100_000 }),
    ).toThrow();
    expect(() => validateConfig({ ...DEFAULT_CONFIG, ack: "true" })).toThrow();
    expect(() => validateConfig({ ...DEFAULT_CONFIG, unknown: 1 })).toThrow();
  });
});
