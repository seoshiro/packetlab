import { expect, it } from "vitest";
import { DEFAULT_CONFIG, validateConfig, exportReplay, importReplay } from "../src/core";

it("rejects executable and hidden config fields before reading them", () => {
  let calls = 0;
  const config = { ...DEFAULT_CONFIG };
  Object.defineProperty(config, "messageCount", { enumerable: true, get() { calls++; return calls === 1 ? 1 : -9; } });
  expect(() => validateConfig(config)).toThrow();
  expect(() => exportReplay(config)).toThrow();
  expect(calls).toBe(0);
  const hidden = { ...DEFAULT_CONFIG };
  Object.defineProperty(hidden, "seed", { enumerable: false });
  expect(() => validateConfig(hidden)).toThrow();
  expect(importReplay(exportReplay(DEFAULT_CONFIG))).toEqual(DEFAULT_CONFIG);
});
