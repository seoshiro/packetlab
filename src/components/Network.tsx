import type { Snapshot } from "../core";
import { copy, type Language } from "../i18n";

export function Network({
  snapshot,
  language,
}: {
  snapshot: Snapshot;
  language: Language;
}) {
  const t = copy[language];
  const { config, metrics, inFlight, now } = snapshot;
  const flights = inFlight.slice(0, 36);
  return (
    <div className="network" data-testid="network">
      <div className="network-legend">
        <span>
          <i className="legend-data" /> DATA
        </span>
        <span>
          <i className="legend-ack" /> ACK
        </span>
        <span className="network-legend-note">
          FIFO / {config.queueCapacity}
        </span>
      </div>
      <svg className="network-svg" viewBox="0 0 900 258" aria-hidden="true">
        <defs>
          <pattern
            id="dot-grid"
            width="18"
            height="18"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1" cy="1" r=".8" fill="#535958" opacity=".4" />
          </pattern>
          <marker
            id="arrow-data"
            viewBox="0 0 10 10"
            refX="7"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10" fill="#eb6d4b" />
          </marker>
          <marker
            id="arrow-ack"
            viewBox="0 0 10 10"
            refX="7"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10" fill="#a8c8b4" />
          </marker>
        </defs>
        <rect x="200" y="15" width="500" height="228" fill="url(#dot-grid)" />
        <rect
          x="20"
          y="62"
          width="166"
          height="132"
          rx="10"
          className="node-box"
        />
        <path
          d="M 44 88 h 15 v 15 h -15 z M 66 88 h 15 v 15 h -15 z M 44 110 h 15 v 15 h -15 z"
          fill="none"
          stroke="#e97353"
          strokeWidth="1.5"
        />
        <text x="44" y="150" className="node-name">
          {t.sender}
        </text>
        <text x="44" y="175" className="node-value">
          {metrics.sent} <tspan className="node-small">{t.dispatched}</tspan>
        </text>
        <rect
          x="714"
          y="62"
          width="166"
          height="132"
          rx="10"
          className="node-box receiver-box"
        />
        <path
          d="M 741 94 l 8 8 l 16 -19"
          fill="none"
          stroke="#b5d4bd"
          strokeWidth="2"
        />
        <text x="738" y="150" className="node-name">
          {t.receiver}
        </text>
        <text x="738" y="175" className="node-value">
          {metrics.delivered} <tspan className="node-small">{t.unique}</tspan>
        </text>
        <line
          x1="186"
          y1="111"
          x2="708"
          y2="111"
          className="data-wire"
          markerEnd="url(#arrow-data)"
        />
        <line
          x1="714"
          y1="153"
          x2="192"
          y2="153"
          className={`ack-wire ${config.ack ? "" : "disabled-wire"}`}
          markerEnd="url(#arrow-ack)"
        />
        <text x="450" y="76" textAnchor="middle" className="channel-title">
          {t.unreliable}
        </text>
        <text
          x="450"
          y="210"
          textAnchor="middle"
          className="channel-conditions"
        >
          {Math.round(config.loss * 100)}% {t.loss} ·{" "}
          {Math.round(config.duplicate * 100)}% {t.duplicate} · {config.delayMs}
          ms
        </text>
        <text x="212" y="99" className="wire-label">
          DATA
        </text>
        <text x="679" y="174" textAnchor="end" className="wire-label">
          {config.ack ? "ACK" : t.noAck}
        </text>
        {flights.map((flight, index) => {
          const progress = Math.max(
            0,
            Math.min(
              1,
              (now - flight.start) / Math.max(1, flight.end - flight.start),
            ),
          );
          const x =
            flight.kind === "data"
              ? 190 + progress * 518
              : 710 - progress * 518;
          const y =
            (flight.kind === "data" ? 111 : 153) + ((index % 3) - 1) * 5;
          return (
            <g key={flight.id} className="packet">
              <rect
                x={x - 9}
                y={y - 6}
                width="18"
                height="12"
                rx="2"
                fill={flight.kind === "data" ? "#ed7857" : "#b5d4bd"}
                stroke={flight.duplicate ? "#fff0cf" : "none"}
                strokeWidth="2"
              />
              <text x={x} y={y + 3} textAnchor="middle" className="packet-id">
                {flight.messageId}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mobile-network" aria-hidden="true">
        <div className="mobile-node">
          <strong>{t.sender}</strong>
          <b>
            {metrics.sent}
            <small>DATA</small>
          </b>
        </div>
        <div className="mobile-link">
          <span>DATA</span>
          <small>
            {Math.round(config.loss * 100)}% {t.loss}
            <br />
            {config.delayMs}ms
          </small>
          <span className="ack-lane">{config.ack ? "ACK" : "× ACK"}</span>
        </div>
        <div className="mobile-node">
          <strong>{t.receiver}</strong>
          <b>
            {metrics.delivered}
            <small>{t.unique}</small>
          </b>
        </div>
      </div>
      <div
        className="network-summary"
        data-testid="network-text-alternative"
        aria-label={t.textAlternative}
      >
        <span className="direction-summary">
          DATA: {t.sender} → {t.receiver} · ACK:{" "}
          {config.ack ? `${t.receiver} → ${t.sender}` : t.noAck}
        </span>
        <span>
          <b>{inFlight.length}</b> {t.inFlight.toLowerCase()}
        </span>
        <span>
          <b>{snapshot.pending.length}</b> {t.pending.toLowerCase()}
        </span>
        <span>
          <b>{metrics.dropped}</b> {t.dropped.toLowerCase()}
        </span>
        <span>
          <b>{metrics.acknowledged}</b> ACK
        </span>
      </div>
    </div>
  );
}
