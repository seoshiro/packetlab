import { DEFAULT_CONFIG } from "./config";
import type { Scenario } from "./types";

const burst = {
  ...DEFAULT_CONFIG,
  seed: 73,
  messageCount: 16,
  sendIntervalMs: 0,
  delayMs: 140,
  jitterMs: 30,
  loss: 0.12,
  duplicate: 0,
  ack: true,
  retry: true,
  dedup: false,
  timeoutMs: 120,
  maxAttempts: 8,
  queueCapacity: 4,
  serviceMs: 45,
};

export const SCENARIOS: Scenario[] = [
  {
    id: "naive",
    name: { en: "Send & hope", ru: "Отправить и надеяться" },
    description: {
      en: "One attempt. A lost packet is a lost message. Duplicates can repeat the receiver’s work.",
      ru: "Одна попытка. Потерянный пакет означает потерянное сообщение. Дубли могут повторить действие получателя.",
    },
    config: { ...DEFAULT_CONFIG },
  },
  {
    id: "storm",
    name: { en: "Retry storm", ru: "Шторм повторов" },
    description: {
      en: "A burst meets a small queue. Short synchronized timeouts add traffic before ACKs can return.",
      ru: "Пакетная отправка встречает маленькую очередь. Короткие синхронные таймауты создают повторы до возврата ACK.",
    },
    config: { ...burst },
  },
  {
    id: "backoff",
    name: { en: "Give the link room", ru: "Дать каналу время" },
    description: {
      en: "The same burst with exponential backoff and seeded equal jitter. Retry load spreads over time.",
      ru: "Та же нагрузка с экспоненциальной задержкой и воспроизводимым jitter. Повторы распределяются во времени.",
    },
    config: { ...burst, backoff: true, retryJitter: true },
  },
  {
    id: "dedup",
    name: { en: "Once means once", ru: "Один раз значит один" },
    description: {
      en: "Retries and duplicate packets still arrive. A stable message ID prevents repeated receiver side effects.",
      ru: "Повторы и дубли всё ещё приходят. Стабильный ID сообщения предотвращает повторные действия получателя.",
    },
    config: {
      ...DEFAULT_CONFIG,
      seed: 31415,
      messageCount: 12,
      sendIntervalMs: 75,
      delayMs: 160,
      jitterMs: 70,
      loss: 0.1,
      duplicate: 0.45,
      ack: true,
      retry: true,
      dedup: true,
      backoff: true,
      retryJitter: true,
      timeoutMs: 180,
      maxAttempts: 7,
      queueCapacity: 8,
      serviceMs: 25,
    },
  },
];
