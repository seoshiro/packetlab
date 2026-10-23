import type { Sample } from "../core";
import { copy, type Language } from "../i18n";

type Props = {
  samples: Sample[];
  field: "latency" | "throughput";
  language: Language;
};

export function Chart({ samples, field, language }: Props) {
  const t = copy[language];
  const points = samples.filter((sample) => sample[field] !== null);
  const maxTime = Math.max(1000, ...samples.map((sample) => sample.time));
  const maxValue =
    Math.max(1, ...points.map((sample) => sample[field] ?? 0)) * 1.15;
  const path = points
    .map(
      (sample) =>
        `${48 + (sample.time / maxTime) * 504},${132 - ((sample[field] ?? 0) / maxValue) * 104}`,
    )
    .join(" ");
  const title = field === "latency" ? t.latencyChart : t.throughputChart;
  const unit = field === "latency" ? "ms" : t.sec;
  const latest = points.at(-1)?.[field];
  const format = (value: number) =>
    value >= 100 ? Math.round(value).toString() : value.toFixed(1);
  return (
    <section className="chart-panel" aria-label={title}>
      <div className="chart-heading">
        <h3>{title}</h3>
        <span>
          {latest == null ? "—" : format(latest)} <small>{unit}</small>
        </span>
      </div>
      <svg
        className="chart"
        viewBox="0 0 580 166"
        role="img"
        aria-label={`${title}: ${latest == null ? t.noData : `${format(latest)} ${unit}`}`}
      >
        {[28, 80, 132].map((y, index) => (
          <g key={y}>
            <line x1="48" x2="552" y1={y} y2={y} className="chart-grid" />
            <text x="37" y={y + 4} textAnchor="end">
              {format(maxValue * (1 - index / 2))}
            </text>
          </g>
        ))}
        <text x="48" y="155">
          0
        </text>
        <text x="552" y="155" textAnchor="end">
          {(maxTime / 1000).toFixed(1)} s
        </text>
        {points.length > 0 && (
          <>
            <polyline
              points={path}
              fill="none"
              className={`chart-line ${field}`}
            />
            {points.length === 1 && (
              <circle
                cx={48 + (points[0].time / maxTime) * 504}
                cy={132 - ((points[0][field] ?? 0) / maxValue) * 104}
                r="3"
                className={`chart-dot ${field}`}
              />
            )}
          </>
        )}
        {points.length === 0 && (
          <text x="300" y="83" textAnchor="middle" className="chart-empty">
            {t.chartEmpty}
          </text>
        )}
      </svg>
      <details className="sample-details">
        <summary>
          {t.samples} <span>{points.length}</span>
        </summary>
        <div
          className="table-scroll"
          tabIndex={0}
          aria-label={`${title}: ${t.samples}`}
        >
          {points.length > 50 && (
            <p className="table-note">{t.recentSamples}</p>
          )}
          <table>
            <thead>
              <tr>
                <th>{t.time} (ms)</th>
                <th>
                  {title} ({unit})
                </th>
              </tr>
            </thead>
            <tbody>
              {points.length === 0 ? (
                <tr>
                  <td colSpan={2}>{t.noData}</td>
                </tr>
              ) : (
                points.slice(-50).map((point, index) => (
                  <tr key={`${point.time}-${index}`}>
                    <td>{point.time.toFixed(0)}</td>
                    <td>{format(point[field] ?? 0)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
