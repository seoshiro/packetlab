import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  DEFAULT_CONFIG,
  SCENARIOS,
  Simulation,
  exportReplay,
  importReplay,
  type Config,
  type TraceEntry,
} from "./core";
import { Chart } from "./components/Chart";
import { Network } from "./components/Network";
import { copy, eventLabel, type Language } from "./i18n";
import "./styles.css";

declare const __BUILD_SHA__: string;

function Icon({
  name,
}: {
  name: "play" | "pause" | "step" | "reset" | "replay" | "arrow" | "close";
}) {
  const paths = {
    play: "M7 4l10 8-10 8z",
    pause: "M7 4v16M17 4v16",
    step: "M5 4l10 8-10 8zM19 4v16",
    reset: "M4 10a8 8 0 1 1 2 8M4 4v6h6",
    replay: "M8 3H4v18h16V3h-4M9 3h6v5H9zM8 13h8M8 17h5",
    arrow: "M5 12h14M13 6l6 6-6 6",
    close: "M6 6l12 12M6 18L18 6",
  };
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

function NumberSetting({
  label,
  value,
  min,
  max,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setDraft(String(value));
    setInvalid(false);
  }, [value]);
  function commit() {
    const parsed = Number(draft);
    if (
      draft.trim() === "" ||
      !Number.isInteger(parsed) ||
      parsed < min ||
      parsed > max
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (parsed !== value) onCommit(parsed);
  }
  return (
    <label className={`number-setting ${invalid ? "invalid" : ""}`}>
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step="1"
        value={draft}
        aria-invalid={invalid}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commit();
            event.currentTarget.blur();
          }
        }}
      />
      <small>{invalid ? `${min}–${max}` : ""}</small>
    </label>
  );
}

function reason(entry: TraceEntry | undefined, language: Language) {
  if (!entry)
    return language === "ru"
      ? "Нажмите «Шаг», чтобы разобрать один переход. Пакет, подтверждение и timeout — отдельные события."
      : "Press “Step” to inspect one transition. A packet, its acknowledgment, and its timeout are separate events.";
  const reasons: Record<string, { ru: string; en: string }> = {
    send: {
      ru: "Новое сообщение входит в канал. Его message ID сохраняется при всех последующих попытках.",
      en: "A new message enters the channel. Its message ID stays the same across all later attempts.",
    },
    retry: {
      ru: "Отправитель ещё не получил ACK. Он повторяет тот же message ID — получатель мог уже применить его.",
      en: "The sender has not received an ACK. It retries the same message ID, even though the receiver may have already applied it.",
    },
    queue: {
      ru: "Пакет ждёт обслуживания в конечной FIFO-очереди. Частые повторы могут вытеснять полезную работу.",
      en: "The packet waits for service in a finite FIFO queue. Frequent retries can crowd out useful work.",
    },
    transmit: {
      ru: "Пакет покинул очередь. Теперь до получения проходит заданная задержка канала.",
      en: "The packet has left the queue. The configured channel delay now passes before arrival.",
    },
    drop_loss: {
      ru: "Seed-генератор выбрал потерю. У отправителя нет прямого знания об этой потере: он ждёт ACK или timeout.",
      en: "The seeded generator selected a loss. The sender cannot directly observe it: it waits for an ACK or timeout.",
    },
    drop_overflow: {
      ru: "В очереди больше нет места. Пакет отброшен, даже если случайная потеря канала равна нулю.",
      en: "The queue has no room left. The packet is dropped even if random channel loss is zero.",
    },
    duplicate: {
      ru: "Канал создал ещё одну копию пакета. Дубли могут появиться и без повторной отправки.",
      en: "The channel created another copy of the packet. Duplicates can happen even without a retry.",
    },
    deliver: {
      ru: "Получатель впервые увидел этот message ID. Только первая доставка увеличивает полезную пропускную способность.",
      en: "The receiver saw this message ID for the first time. Only first delivery increases useful throughput.",
    },
    apply: {
      ru: "Получатель выполнил эффект сообщения. Без dedup повторный DATA может выполнить этот эффект ещё раз.",
      en: "The receiver applied the message’s side effect. Without dedup, another DATA can apply that effect again.",
    },
    dedup: {
      ru: "Этот message ID уже обработан. Получатель подавил повторный эффект, но всё равно может отправить ACK.",
      en: "This message ID was already handled. The receiver suppressed the repeated side effect, but can still send an ACK.",
    },
    ack_send: {
      ru: "Получатель отправляет подтверждение. ACK проходит через тот же ненадёжный механизм и тоже может потеряться.",
      en: "The receiver sends an acknowledgment. ACK travels through the same unreliable mechanism and can also be lost.",
    },
    ack_receive: {
      ru: "Отправитель узнал о доставке. Ожидающие timeout для этого сообщения больше не создадут повтор.",
      en: "The sender learned about delivery. Pending timeouts for this message will no longer cause retries.",
    },
    timeout: {
      ru: "Время ожидания ACK истекло. Это не доказывает потерю DATA: подтверждение могло задержаться или потеряться.",
      en: "The ACK wait expired. This does not prove DATA was lost: its acknowledgment may be delayed or lost.",
    },
    exhausted: {
      ru: "Бюджет попыток исчерпан. Сообщение могло быть доставлено, но отправитель не получил подтверждения.",
      en: "The attempt budget is exhausted. The message may have arrived, but the sender has no acknowledgment.",
    },
    complete: {
      ru: "Очередь событий пуста. Итог детерминирован: та же конфигурация и seed дадут тот же результат.",
      en: "The event queue is empty. The result is deterministic: the same configuration and seed reproduce it.",
    },
    limit: {
      ru: "Сработал защитный предел модели. Ограничение удерживает работу и память браузера в разумных пределах.",
      en: "A model safety bound was reached. The limit keeps browser work and memory bounded.",
    },
  };
  return reasons[entry.kind]?.[language] ?? entry.detail;
}

export default function App() {
  const [language, setLanguage] = useState<Language>("ru");
  const t = copy[language];
  const [initialEngine] = useState(() => new Simulation(DEFAULT_CONFIG));
  const engine = useRef(initialEngine);
  const [snapshot, setSnapshot] = useState(() => engine.current.getSnapshot());
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [scenarioId, setScenarioId] = useState(
    () =>
      SCENARIOS.find(
        (scenario) =>
          JSON.stringify(scenario.config) === JSON.stringify(DEFAULT_CONFIG),
      )?.id ?? SCENARIOS[0].id,
  );
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [replayOpen, setReplayOpen] = useState(false);
  const [replayText, setReplayText] = useState("");
  const [replayError, setReplayError] = useState("");
  const [readingFile, setReadingFile] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const config = snapshot.config;
  const terminal =
    snapshot.status === "complete" || snapshot.status === "limited";
  const activeScenario = SCENARIOS.find(
    (scenario) => scenario.id === scenarioId,
  );
  const selectedTrace =
    snapshot.trace.find((entry) => entry.id === selectedEvent) ??
    snapshot.trace.at(-1);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      try {
        const next = engine.current.advanceTo(
          engine.current.getSnapshot().now + 50 * speed,
        );
        setSnapshot(next);
        if (next.status === "complete" || next.status === "limited")
          setRunning(false);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        setRunning(false);
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, [running, speed]);

  useEffect(() => {
    if (replayOpen) dialog.current?.showModal();
    else dialog.current?.close();
  }, [replayOpen]);

  function reset(nextConfig = config, message = "") {
    try {
      engine.current = new Simulation(nextConfig);
      setSnapshot(engine.current.getSnapshot());
      setRunning(false);
      setSelectedEvent(null);
      setError("");
      setNotice(message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setRunning(false);
    }
  }

  function toggleRun() {
    if (terminal) reset();
    setRunning((previous) => (terminal ? true : !previous));
    setNotice("");
  }

  function step() {
    if (terminal) return;
    setRunning(false);
    setNotice("");
    try {
      setSnapshot(engine.current.step());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target;
      if (
        replayOpen ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.repeat ||
        (target instanceof HTMLElement &&
          (target.isContentEditable ||
            /^(INPUT|TEXTAREA|SELECT|BUTTON|SUMMARY|A)$/.test(target.tagName)))
      )
        return;
      if (event.code === "Space") {
        event.preventDefault();
        toggleRun();
      }
      if (event.code === "ArrowRight") {
        event.preventDefault();
        step();
      }
      if (event.code === "KeyR") {
        event.preventDefault();
        reset();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function update<K extends keyof Config>(key: K, value: Config[K]) {
    const next = { ...config, [key]: value };
    setScenarioId("custom");
    reset(next, t.changed);
  }

  function openReplay() {
    setReplayText(exportReplay(config));
    setReplayError("");
    setRunning(false);
    setReplayOpen(true);
  }

  function loadReplay() {
    try {
      const next = importReplay(replayText);
      setScenarioId("custom");
      reset(next, t.imported);
      setReplayOpen(false);
    } catch (caught) {
      setReplayError(
        `${t.invalid} ${caught instanceof Error ? caught.message : String(caught)}`,
      );
    }
  }

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setReplayError("");
    if (file.size > 65536) {
      setReplayError(t.fileTooLarge);
      event.target.value = "";
      return;
    }
    setReadingFile(true);
    try {
      setReplayText(await file.text());
    } catch {
      setReplayError(t.invalid);
    } finally {
      setReadingFile(false);
      event.target.value = "";
    }
  }

  function downloadReplay() {
    const url = URL.createObjectURL(
      new Blob([exportReplay(config)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `packetlab-seed-${config.seed}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const ranges: {
    key: "loss" | "duplicate" | "delayMs" | "jitterMs";
    label: string;
    min: number;
    max: number;
    step: number;
    unit: string;
  }[] = [
    { key: "loss", label: t.lossLabel, min: 0, max: 100, step: 1, unit: "%" },
    {
      key: "duplicate",
      label: t.duplicateLabel,
      min: 0,
      max: 100,
      step: 1,
      unit: "%",
    },
    {
      key: "delayMs",
      label: t.delayLabel,
      min: 10,
      max: 2000,
      step: 10,
      unit: "ms",
    },
    {
      key: "jitterMs",
      label: t.jitterLabel,
      min: 0,
      max: 1000,
      step: 10,
      unit: "ms",
    },
  ];
  const toggles: {
    key: "ack" | "retry" | "dedup" | "backoff" | "retryJitter";
    label: string;
    hint: string;
    disabled?: boolean;
  }[] = [
    { key: "ack", label: t.ackLabel, hint: t.ackHint },
    { key: "retry", label: t.retryLabel, hint: t.retryHint },
    { key: "dedup", label: t.dedupLabel, hint: t.dedupHint },
    {
      key: "backoff",
      label: t.backoffLabel,
      hint: t.backoffHint,
      disabled: !config.retry,
    },
    {
      key: "retryJitter",
      label: t.retryJitterLabel,
      hint: t.retryJitterHint,
      disabled: !config.retry,
    },
  ];
  const statusText =
    snapshot.status === "complete"
      ? t.complete
      : snapshot.status === "limited"
        ? t.limited
        : running
          ? t.active
          : snapshot.status === "ready"
            ? t.ready
            : t.paused;
  const metricCards = [
    {
      id: "delivered",
      label: t.delivery,
      value: snapshot.metrics.delivered,
      suffix: `/ ${config.messageCount}`,
      hint: t.deliveryHint,
      primary: true,
    },
    {
      id: "latency",
      label: t.latency,
      value:
        snapshot.metrics.meanLatency === null
          ? "—"
          : Math.round(snapshot.metrics.meanLatency),
      suffix: "ms",
      hint: t.latencyHint,
    },
    {
      id: "throughput",
      label: t.throughput,
      value: snapshot.metrics.throughput.toFixed(1),
      suffix: t.sec,
      hint: t.throughputHint,
    },
    {
      id: "applied",
      label: t.applications,
      value: snapshot.metrics.applied,
      suffix: "",
      hint: t.applicationsHint,
    },
    {
      id: "retries",
      label: t.retries,
      value: snapshot.metrics.retries,
      suffix: "",
      hint: t.retriesHint,
    },
  ];

  return (
    <>
      <a className="skip-link" href="#experiment">
        {t.skip}
      </a>
      <header className="site-header shell">
        <a className="brand" href="#">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>
            PACKET<span className="brand-light">LAB</span>
            <small>{t.lab}</small>
          </span>
        </a>
        <div className="header-actions">
          <a
            className="source-link"
            href="https://github.com/seoshiro/packetlab"
            target="_blank"
            rel="noreferrer"
          >
            GitHub <span aria-hidden="true">↗</span>
            <span className="sr-only"> — {t.source}</span>
          </a>
          <div
            className="language-switch"
            role="group"
            aria-label="Language / Язык"
            data-testid="language-selector"
          >
            <button
              type="button"
              aria-pressed={language === "ru"}
              onClick={() => setLanguage("ru")}
              data-testid="language-ru"
            >
              RU
            </button>
            <button
              type="button"
              aria-pressed={language === "en"}
              onClick={() => setLanguage("en")}
              data-testid="language-en"
            >
              EN
            </button>
          </div>
        </div>
      </header>
      <main className="shell">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="little-cross" aria-hidden="true">
                +
              </span>
              {t.eyebrow}
            </p>
            <h1>
              {t.title}
              <br />
              <em>{t.titleAccent}</em>
            </h1>
            <p className="hero-description">{t.intro}</p>
          </div>
          <div className="hero-aside">
            <div className="hero-diagram" aria-hidden="true">
              <span className="diagram-node">A</span>
              <span className="diagram-track">
                <i />
                <i />
                <b>×</b>
                <i />
              </span>
              <span className="diagram-node">B</span>
            </div>
            <p>
              <span className="square-status" />
              {t.honest}
            </p>
            <span>{t.honestDetail}</span>
            <div className="spec-line">
              2 NODES <span>/</span> 1 QUESTION <span>/</span> 0 SERVERS
            </div>
          </div>
        </section>
        <section
          aria-labelledby="scenario-heading"
          className="scenario-section"
        >
          <div className="section-label">
            <h2 id="scenario-heading">{t.choose}</h2>
            <p>{t.chooseHint}</p>
          </div>
          <div className="scenario-grid">
            {SCENARIOS.map((scenario, index) => (
              <button
                type="button"
                className={`scenario-card ${scenarioId === scenario.id ? "selected" : ""}`}
                key={scenario.id}
                onClick={() => {
                  setScenarioId(scenario.id);
                  reset(scenario.config);
                }}
                aria-pressed={scenarioId === scenario.id}
                data-testid={`scenario-${scenario.id}`}
              >
                <span className="scenario-top">
                  <span className="scenario-number">0{index + 1}</span>
                  <span
                    className={`scenario-glyph glyph-${index}`}
                    aria-hidden="true"
                  >
                    {index === 0
                      ? "→  ×"
                      : index === 1
                        ? "↻↻↻"
                        : index === 2
                          ? "·  ·   ·"
                          : "≡ → 1"}
                  </span>
                  <span className="scenario-check" aria-hidden="true">
                    {scenarioId === scenario.id ? "↗" : "+"}
                  </span>
                </span>
                <strong>{scenario.name[language]}</strong>
                <span className="scenario-description">
                  {scenario.description[language]}
                </span>
              </button>
            ))}
          </div>
        </section>
        <section
          className="lab-section"
          id="experiment"
          aria-labelledby="lab-heading"
        >
          <div className="section-label">
            <h2 id="lab-heading">{t.instrument}</h2>
            <button
              className="text-button replay-trigger"
              type="button"
              onClick={openReplay}
              data-testid="replay-open"
            >
              <Icon name="replay" />
              {t.replay}
              <span className="schema-badge">v1</span>
            </button>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
          <div className="lab-grid">
            <div className="experiment-main">
              <div className="instrument-panel">
                <div className="instrument-topline">
                  <div
                    className={`status-light ${running ? "is-running" : ""}`}
                  >
                    <i />
                    <span
                      data-testid="simulation-status"
                      data-status={snapshot.status}
                    >
                      {statusText}
                    </span>
                  </div>
                  <span className="seed-badge">SEED {config.seed}</span>
                  <div className="simulation-clock">
                    <span>{t.simulated}</span>
                    <strong data-testid="simulation-time">
                      {(snapshot.now / 1000).toFixed(2)}
                      <small>s</small>
                    </strong>
                  </div>
                </div>
                <div className="playback-bar">
                  <div className="playback-buttons">
                    <button
                      type="button"
                      className="run-button"
                      onClick={toggleRun}
                      data-testid="play-pause"
                      aria-pressed={running}
                    >
                      <Icon name={running ? "pause" : "play"} />
                      {running ? t.pause : t.play}
                    </button>
                    <button
                      type="button"
                      className="instrument-button"
                      onClick={step}
                      disabled={terminal}
                      data-testid="step"
                    >
                      <Icon name="step" />
                      {t.step}
                    </button>
                    <button
                      type="button"
                      className="instrument-button reset-button"
                      onClick={() => reset()}
                      data-testid="reset"
                      aria-label={t.reset}
                    >
                      <Icon name="reset" />
                      <span>{t.reset}</span>
                    </button>
                  </div>
                  <label className="speed-control">
                    {t.speed}
                    <select
                      value={speed}
                      onChange={(event) => setSpeed(Number(event.target.value))}
                      data-testid="speed"
                    >
                      <option value="0.5">0.5×</option>
                      <option value="1">1×</option>
                      <option value="2">2×</option>
                      <option value="4">4×</option>
                      <option value="16">16×</option>
                    </select>
                  </label>
                </div>
                <Network snapshot={snapshot} language={language} />
              </div>
              <p className="keyboard-help">{t.help}</p>
              {snapshot.warning && (
                <p className="warning-banner" role="status">
                  {snapshot.warning}
                </p>
              )}
              <div className="metrics-grid">
                {metricCards.map((metric) => (
                  <div
                    key={metric.id}
                    className={`metric ${metric.primary ? "metric-primary" : ""}`}
                    title={metric.hint}
                  >
                    <p>{metric.label}</p>
                    <strong data-testid={`metric-${metric.id}`}>
                      {metric.value}
                      <small>{metric.suffix}</small>
                    </strong>
                    <span>{metric.hint}</span>
                  </div>
                ))}
              </div>
              <p className="metrics-disclaimer">
                <span aria-hidden="true">↳</span> {t.metricsNote}
              </p>
              <div
                className="message-ledger"
                aria-label={`${t.delivery}: ${snapshot.metrics.delivered} / ${config.messageCount}`}
              >
                <span className="ledger-label">MESSAGE IDs</span>
                <div>
                  {snapshot.messages.map((message) => (
                    <span
                      key={message.id}
                      className={`message-cell ${message.deliveredAt !== null ? "is-delivered" : message.attempts > 0 ? "is-sent" : ""} ${message.failed ? "is-failed" : ""}`}
                      title={`#${message.id} · ${t.attempt}: ${message.attempts} · ${t.effects}: ${message.applications}${message.acknowledged ? " · ACK ✓" : ""}`}
                    >
                      {String(message.id).padStart(2, "0")}
                      {message.acknowledged && <i aria-hidden="true" />}
                    </span>
                  ))}
                </div>
              </div>
              <details className="outcomes-details">
                <summary>
                  {t.outcomes}
                  <span>{snapshot.messages.length}</span>
                </summary>
                <div
                  className="table-scroll"
                  tabIndex={0}
                  aria-label={t.outcomes}
                >
                  <table>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>{t.attempt}</th>
                        <th>{t.firstDelivery}</th>
                        <th>{t.effects}</th>
                        <th>ACK</th>
                        <th>{t.messageStatus}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.messages.map((message) => (
                        <tr key={message.id}>
                          <td>#{message.id}</td>
                          <td>{message.attempts}</td>
                          <td>
                            {message.deliveredAt === null
                              ? "—"
                              : message.deliveredAt}
                          </td>
                          <td>{message.applications}</td>
                          <td>{message.acknowledged ? t.yes : t.no}</td>
                          <td>
                            {message.acknowledged
                              ? `ACK ${t.yes}`
                              : message.failed
                                ? config.ack
                                  ? t.unconfirmed
                                  : t.undelivered
                                : message.deliveredAt !== null
                                  ? t.delivered
                                  : message.attempts > 0
                                    ? t.sent
                                    : t.unsent}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
            <aside
              className="settings-panel"
              aria-labelledby="settings-heading"
            >
              <div className="settings-heading">
                <h3 id="settings-heading">{t.settings}</h3>
                <span aria-hidden="true">⌘</span>
              </div>
              <p className="settings-hint">{t.settingsHint}</p>
              <div className="range-settings">
                {ranges.map((range) => {
                  const percent =
                    range.key === "loss" || range.key === "duplicate";
                  const value = percent
                    ? Math.round(config[range.key] * 100)
                    : config[range.key];
                  return (
                    <label className="range-setting" key={range.key}>
                      <span>
                        {range.label}
                        <output>
                          {value}
                          <small>{range.unit}</small>
                        </output>
                      </span>
                      <input
                        type="range"
                        min={range.min}
                        max={range.max}
                        step={range.step}
                        value={value}
                        onChange={(event) =>
                          update(
                            range.key,
                            Number(event.target.value) / (percent ? 100 : 1),
                          )
                        }
                        data-testid={`config-${range.key}`}
                      />
                      <span className="range-endpoints">
                        <small>
                          {range.min}
                          {range.unit}
                        </small>
                        <small>
                          {range.max}
                          {range.unit}
                        </small>
                      </span>
                    </label>
                  );
                })}
              </div>
              <h4 className="settings-subheading">{t.protocol}</h4>
              <div className="toggle-settings">
                {toggles.map((toggle) => (
                  <label
                    key={toggle.key}
                    className={`toggle-setting ${toggle.disabled ? "is-disabled" : ""}`}
                  >
                    <span>
                      <strong>{toggle.label}</strong>
                      <small>{toggle.hint}</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={config[toggle.key]}
                      disabled={toggle.disabled}
                      onChange={(event) =>
                        update(toggle.key, event.target.checked)
                      }
                      data-testid={`config-${toggle.key}`}
                    />
                    <span className="switch" aria-hidden="true" />
                  </label>
                ))}
              </div>
              {!config.ack && (
                <p className="dependency-hint">{t.retryNeedsAck}</p>
              )}
              <details className="advanced-settings">
                <summary>
                  {t.advanced}
                  <span aria-hidden="true">+</span>
                </summary>
                <div className="number-grid">
                  <NumberSetting
                    label={t.seed}
                    value={config.seed}
                    min={0}
                    max={4294967295}
                    onCommit={(value) => update("seed", value)}
                  />
                  <NumberSetting
                    label={t.count}
                    value={config.messageCount}
                    min={1}
                    max={40}
                    onCommit={(value) => update("messageCount", value)}
                  />
                  <NumberSetting
                    label={t.interval}
                    value={config.sendIntervalMs}
                    min={0}
                    max={2000}
                    onCommit={(value) => update("sendIntervalMs", value)}
                  />
                  <NumberSetting
                    label={t.timeout}
                    value={config.timeoutMs}
                    min={20}
                    max={5000}
                    onCommit={(value) => update("timeoutMs", value)}
                  />
                  <NumberSetting
                    label={t.attempts}
                    value={config.maxAttempts}
                    min={1}
                    max={12}
                    onCommit={(value) => update("maxAttempts", value)}
                  />
                  <NumberSetting
                    label={t.capacity}
                    value={config.queueCapacity}
                    min={1}
                    max={64}
                    onCommit={(value) => update("queueCapacity", value)}
                  />
                  <NumberSetting
                    label={t.service}
                    value={config.serviceMs}
                    min={10}
                    max={500}
                    onCommit={(value) => update("serviceMs", value)}
                  />
                </div>
              </details>
            </aside>
          </div>
        </section>
        <section className="observations" aria-labelledby="analysis-heading">
          <div className="section-label">
            <h2 id="analysis-heading">{t.analysis}</h2>
            <span className="section-meta">
              DETERMINISTIC / LOCAL / BOUNDED
            </span>
          </div>
          <div className="charts-grid">
            <Chart
              samples={snapshot.series}
              field="latency"
              language={language}
            />
            <Chart
              samples={snapshot.series}
              field="throughput"
              language={language}
            />
          </div>
          <div className="events-grid">
            <section className="event-panel">
              <div className="panel-heading">
                <h3>{t.trace}</h3>
                <span className="count-tag">{snapshot.trace.length}</span>
              </div>
              <div className="event-list" data-testid="event-trace">
                {snapshot.trace.length === 0 ? (
                  <div className="empty-state">
                    <span aria-hidden="true">↳</span>
                    <p>{t.traceEmpty}</p>
                  </div>
                ) : (
                  snapshot.trace
                    .slice(-24)
                    .reverse()
                    .map((entry) => (
                      <button
                        type="button"
                        key={entry.id}
                        className={`trace-row ${selectedTrace?.id === entry.id ? "is-selected" : ""}`}
                        onClick={() => setSelectedEvent(entry.id)}
                        aria-pressed={selectedTrace?.id === entry.id}
                      >
                        <span className="event-time">
                          {entry.time.toFixed(0)}
                          <small>ms</small>
                        </span>
                        <span className={`event-dot kind-${entry.kind}`} />
                        <span className="event-label">
                          {eventLabel(entry.kind, language)}
                        </span>
                        <span className="event-message">
                          {entry.messageId > 0
                            ? `#${String(entry.messageId).padStart(2, "0")}`
                            : "—"}
                        </span>
                        <span className="event-attempt">
                          {entry.attempt > 0 ? `×${entry.attempt}` : ""}
                        </span>
                      </button>
                    ))
                )}
              </div>
            </section>
            <section className="queue-panel">
              <div className="panel-heading">
                <h3>{t.queue}</h3>
                <span className="count-tag">{snapshot.pending.length}</span>
              </div>
              <div
                className="queue-list"
                data-testid="event-queue"
                tabIndex={0}
                aria-label={t.queue}
              >
                {snapshot.pending.length === 0 ? (
                  <div className="empty-state">
                    <span aria-hidden="true">✓</span>
                    <p>{t.queueEmpty}</p>
                  </div>
                ) : (
                  snapshot.pending.slice(0, 7).map((entry, index) => (
                    <div className="queue-row" key={entry.id}>
                      <span className="queue-order">
                        {index === 0 ? (
                          <span className="next-marker" aria-label={t.next}>
                            →
                          </span>
                        ) : (
                          String(index + 1).padStart(2, "0")
                        )}
                      </span>
                      <div>
                        <strong>{eventLabel(entry.kind, language)}</strong>
                        <span>
                          #{entry.messageId} · {t.attempt} {entry.attempt}
                        </span>
                      </div>
                      <time>
                        {entry.time.toFixed(0)}
                        <small>ms</small>
                      </time>
                    </div>
                  ))
                )}
              </div>
              <div className="reason-panel">
                <span className="reason-label">{t.lesson}</span>
                <h4>
                  {selectedTrace
                    ? eventLabel(selectedTrace.kind, language)
                    : (activeScenario?.name[language] ?? "PACKETLAB")}
                </h4>
                <p>{reason(selectedTrace, language)}</p>
                {selectedTrace && (
                  <details className="technical-detail">
                    <summary>
                      {language === "ru"
                        ? "Точная запись модели"
                        : "Exact model record"}
                    </summary>
                    <code>{selectedTrace.detail}</code>
                  </details>
                )}
              </div>
            </section>
          </div>
        </section>
        <section className="model-note" id="model">
          <div className="model-symbol" aria-hidden="true">
            ↔
          </div>
          <div>
            <span className="eyebrow">PACKET ≠ MESSAGE ≠ EFFECT</span>
            <h2>{t.modelTitle}</h2>
            <p>{t.modelText}</p>
            <p className="model-limit">{t.modelLimit}</p>
          </div>
        </section>
      </main>
      <footer className="site-footer shell">
        <span>{t.footer}</span>
        <div>
          <a href="#model">{t.model}</a>
          <span
            className="build-sha"
            data-testid="build-sha"
            data-build-sha={__BUILD_SHA__}
            title={__BUILD_SHA__}
          >
            {t.build}{" "}
            <code>
              {typeof __BUILD_SHA__ !== "undefined"
                ? __BUILD_SHA__.slice(0, 8)
                : "local"}
            </code>
          </span>
        </div>
      </footer>
      <dialog
        className="replay-dialog"
        ref={dialog}
        onClose={() => setReplayOpen(false)}
        onCancel={() => setReplayOpen(false)}
        aria-labelledby="replay-title"
        data-testid="replay-dialog"
      >
        <div className="dialog-heading">
          <span className="eyebrow">PACKETLAB / REPLAY v1</span>
          <button
            type="button"
            className="icon-button"
            onClick={() => setReplayOpen(false)}
            aria-label={t.close}
          >
            <Icon name="close" />
          </button>
        </div>
        <h2 id="replay-title">{t.replayTitle}</h2>
        <p>{t.replayIntro}</p>
        <label className="replay-text-label" htmlFor="replay-json">
          {t.replayLabel}
        </label>
        <textarea
          id="replay-json"
          spellCheck={false}
          value={replayText}
          onChange={(event) => {
            setReplayText(event.target.value);
            setReplayError("");
          }}
          maxLength={65536}
          data-testid="replay-textarea"
          disabled={readingFile}
        />
        {replayError && (
          <p className="replay-error" role="alert" data-testid="replay-error">
            {replayError}
          </p>
        )}
        {readingFile && <p role="status">{t.loading}</p>}
        <div className="file-control">
          <label>
            {t.loadFile}
            <input
              type="file"
              accept=".json,application/json"
              onChange={readFile}
              disabled={readingFile}
              data-testid="replay-file"
            />
          </label>
        </div>
        <div className="dialog-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={downloadReplay}
            data-testid="replay-export"
          >
            {t.export} <span aria-hidden="true">↓</span>
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={loadReplay}
            disabled={readingFile}
            data-testid="replay-import"
          >
            {t.import}
            <Icon name="arrow" />
          </button>
        </div>
      </dialog>
    </>
  );
}
