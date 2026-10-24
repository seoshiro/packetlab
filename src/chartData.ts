import type { Sample } from "./core";

/** A current display endpoint; model sampling and seeded execution stay untouched. */
export function chartSeries(
  samples: readonly Sample[],
  current: Sample,
): Sample[] {
  const previous = samples.at(-1);
  return previous?.time === current.time
    ? [...samples.slice(0, -1), current]
    : [...samples, current];
}
