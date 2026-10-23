import type { Config } from "./types";

export const LIMITS = Object.freeze({
  maxPending: 4096,
  maxEvents: 20000,
  maxTimeMs: 180000,
  maxTrace: 512,
  maxSamples: 256,
  maxReplayLength: 8192,
  maxRetryDelayMs: 32000,
});

export const DEFAULT_CONFIG: Config = {
  seed: 2026,
  messageCount: 16,
  sendIntervalMs: 80,
  delayMs: 220,
  jitterMs: 90,
  loss: 0.3,
  duplicate: 0.12,
  ack: false,
  retry: false,
  dedup: false,
  backoff: false,
  retryJitter: false,
  timeoutMs: 500,
  maxAttempts: 6,
  queueCapacity: 6,
  serviceMs: 35,
};

const integerRanges: Partial<Record<keyof Config, readonly [number, number]>> =
  {
    seed: [0, 4294967295],
    messageCount: [1, 40],
    sendIntervalMs: [0, 2000],
    delayMs: [10, 2000],
    jitterMs: [0, 1000],
    timeoutMs: [20, 5000],
    maxAttempts: [1, 12],
    queueCapacity: [1, 64],
    serviceMs: [10, 500],
  };
const booleanKeys: (keyof Config)[] = [
  "ack",
  "retry",
  "dedup",
  "backoff",
  "retryJitter",
];
const keys = Object.keys(DEFAULT_CONFIG);

function record(input: unknown, label: string): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${label} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain object.`);
  }
  return input as Record<string, unknown>;
}

/** Strict, total validation: unknown fields, omissions and coercion are rejected. */
export function validateConfig(input: unknown): Config {
  const candidate = record(input, "Configuration");
  const ownKeys = Reflect.ownKeys(candidate);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
  ) {
    throw new Error("Configuration fields do not match schema version 1.");
  }
  const validated: [string, unknown][] = [];
  for (const key of keys as (keyof Config)[]) {
    const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error("Configuration must contain enumerable data fields only.");
    }
    const value: unknown = descriptor.value;
    if (booleanKeys.includes(key)) {
      if (typeof value !== "boolean")
        throw new Error(`${key} must be a boolean.`);
    } else {
      if (typeof value !== "number" || !Number.isFinite(value))
        throw new Error(`${key} must be finite.`);
      const range = integerRanges[key];
      if (range) {
        if (!Number.isInteger(value) || value < range[0] || value > range[1]) {
          throw new Error(
            `${key} must be an integer from ${range[0]} to ${range[1]}.`,
          );
        }
      } else if (value < 0 || value > 1) {
        throw new Error(`${key} must be from 0 to 1.`);
      }
    }
    validated.push([key, value]);
  }
  return Object.fromEntries(validated) as unknown as Config;
}

/** Replay = initial configuration, not a saved animation cursor or untrusted code. */
export function exportReplay(config: Config): string {
  return JSON.stringify(
    { schemaVersion: 1, config: validateConfig(config) },
    null,
    2,
  );
}

export function importReplay(text: string): Config {
  if (typeof text !== "string" || text.length > LIMITS.maxReplayLength) {
    throw new Error(
      `Replay must be at most ${LIMITS.maxReplayLength} characters.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Replay is not valid JSON.");
  }
  const envelope = record(parsed, "Replay");
  const envelopeKeys = Object.keys(envelope);
  if (
    envelopeKeys.length !== 2 ||
    !envelopeKeys.includes("schemaVersion") ||
    !envelopeKeys.includes("config")
  ) {
    throw new Error("Replay must contain only schemaVersion and config.");
  }
  if (envelope.schemaVersion !== 1)
    throw new Error("Unsupported replay schemaVersion. Expected 1.");
  return validateConfig(envelope.config);
}
