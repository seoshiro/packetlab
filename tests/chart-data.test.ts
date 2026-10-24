import { expect, it } from "vitest";
import { DEFAULT_CONFIG, Simulation } from "../src/core";
import { chartSeries } from "../src/chartData";

it("displays elapsed-time throughput at the current snapshot without mutating model history", () => {
  const engine = new Simulation({
    ...DEFAULT_CONFIG,
    messageCount: 2,
    sendIntervalMs: 2000,
    serviceMs: 10,
    delayMs: 10,
    jitterMs: 0,
    loss: 0,
    duplicate: 0,
    ack: false,
    retry: false,
  });
  const snapshot = engine.advanceTo(1000);
  const original = structuredClone(snapshot.series);
  expect(snapshot.metrics.throughput).toBe(1);
  expect(snapshot.series.at(-1)?.throughput).toBe(50);
  const points = chartSeries(Object.freeze(snapshot.series), {
    time: snapshot.now,
    delivered: snapshot.metrics.delivered,
    applied: snapshot.metrics.applied,
    latency: snapshot.metrics.meanLatency,
    throughput: snapshot.metrics.throughput,
  });
  expect(points.at(-1)?.throughput).toBe(snapshot.metrics.throughput);
  expect(points.at(-1)?.time).toBe(1000);
  expect(snapshot.series).toEqual(original);
  expect(engine.getSnapshot().series).toEqual(original);
});
