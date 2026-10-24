import type { Sample } from "../core";
import { copy, type Language } from "../i18n";
import { chartSeries } from "../chartData";

type Props = {
  samples: Sample[];
  current: Sample;
  field: "latency" | "throughput";
  language: Language;
};

export function Chart({ samples, current, field, language }: Props) {
  const t = copy[language];
  const displayed = chartSeries(samples, current);
  const points = displayed.filter((sample) => sample[field] !== null);
  const maxTime = Math.max(1000, ...displayed.map((sample) => sample.time));
  const maxValue =
    Math.max(1, ...points.map((sample) => sample[field] ?? 0)) * 1.15;
  const path = points
    .map(
      (sample) =>
        `${(sample.time / maxTime) * 504},${104 - ((sample[field] ?? 0) / maxValue) * 104}`,
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
      <div
        className="chart-plot"
        role="img"
        aria-label={`${title}: ${latest == null ? t.noData : `${format(latest)} ${unit}`}`}
      >
        <div className="chart-y-axis" aria-hidden="true">
          {[1, 0.5, 0].map((ratio) => (
            <span key={ratio}>{format(maxValue * ratio)}</span>
          ))}
        </div>
        <svg
          className="chart"
          viewBox="0 0 504 104"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {[0, 52, 104].map((y) => (
            <line
              key={y}
              x1="0"
              x2="504"
              y1={y}
              y2={y}
              className="chart-grid"
            />
          ))}
          {points.length > 0 && (
            <>
              <polyline
                points={path}
                fill="none"
                className={`chart-line ${field}`}
              />
              {points.length === 1 && (
                <circle
                  cx={(points[0].time / maxTime) * 504}
                  cy={104 - ((points[0][field] ?? 0) / maxValue) * 104}
                  r="3"
                  className={`chart-dot ${field}`}
                />
              )}
            </>
          )}
        </svg>
        {points.length === 0 && (
          <span className="chart-empty" aria-hidden="true">
            {t.chartEmpty}
          </span>
        )}
        <div className="chart-x-axis" aria-hidden="true">
          <span>0</span>
          <span>{(maxTime / 1000).toFixed(1)} s</span>
        </div>
      </div>
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
