# PACKETLAB independent audit

The independent pre-release audit covered the pure simulation model and the actual browser application. The final combined suite passed **14/14 tests in 21.1 seconds**, with one worker. No reproducible P1/P2 or material P3 finding remains open in the inspected implementation. This is bounded test evidence, not a formal proof for every possible configuration or an accessibility certification.

Public deployment, CI and the final live build SHA comparison are recorded separately by the integrator. A green CI run alone does not establish that the correct build is live.

## Method and environment

All local browser checks and screenshots were performed **on the user's Windows computer**, in a separate Playwright Chromium with **one worker**. No other browser session was controlled. The interface was reviewed at 1440 px desktop and 390 px mobile; horizontal overflow was also checked at 320 and 768 px. Reduced-motion and native keyboard interactions were exercised.

The 21st UI Review skill informed the review. Its CLI was not installed, and its catalog MCP was unavailable; no successful automated 21st review is claimed. Source inspection, axe-core, actual interaction tests and actual screenshots provided the evidence below.

## Model evidence

The nine independent checks in [core-audit.spec.ts](../tests/e2e/core-audit.spec.ts) passed. These use the Playwright runner without launching a browser.

- A configuration export/import round trip produced an identical complete snapshot.
- Five simultaneous messages through a perfect FIFO with 10 ms service and 100 ms propagation arrived at exactly **110, 120, 130, 140 and 150 ms**. Mean first-delivery latency was exactly **130 ms**.
- Four messages with total loss and three attempts terminated with **12 sends, eight retransmissions, zero deliveries and four failures**.
- An ACK with a 220 ms RTT tied a 220 ms deadline and caused exactly one retransmission under stable `(time, id)` insertion order. A 221 ms deadline caused zero retransmissions and completion at 220 ms.
- A one-slot FIFO rejected exactly two of three simultaneous sends, with two visible overflow events and two failed deliveries.
- Across **25 seeds** with loss and duplication, dedup maintained exactly one receiver application per unique delivered message.
- Stepping a saturated run preserved monotonic time, ordered pending events, bounded trace/sample buffers and harmless terminal stepping.
- Mutating returned snapshots did not alter engine internals.
- Malformed, oversized, unsupported-version, unknown-key, nonfinite, wrong-type and out-of-range configuration/replay inputs were rejected.

## Browser evidence

All five workflows in [application.spec.ts](../tests/e2e/application.spec.ts) passed during local verification. The final combined run against the committed build, and the live rerun with an exact expected SHA, belong to release verification.

- Russian and English initial states expose honest simulation/model limitations and the full build identifier.
- Play, pause, step and reset change the actual model state; pause stops time progression.
- Every bundled scenario reaches the same delivered, applied, retry and completion-time result as the pure engine.
- An actual JSON download matches the configuration. Malformed JSON, unsupported schema and oversized files show errors. Valid file import resets reproducibly; Escape closes the native dialog and restores focus.
- An imported configuration with ACK disabled and retry enabled remains editable and consumes its finite attempt budget. Two messages with three attempts produce two unique deliveries, two deduplicated effects and four retransmissions.
- Real Tab/Shift+Tab focus is visible. Invalid seed input is rejected; a valid seed is reflected in replay JSON.
- Reduced motion suppresses actual in-flight SVG particles while preserving visible text and model progress.
- Axe reported **zero critical or serious violations** in the final tested RU/EN initial states, replay dialog and mobile states.
- No horizontal page overflow was observed at 320, 390, 768 or 1440 px.

Actual desktop complete-state, mobile complete-state and mobile instrument screenshots were inspected. They show real model output, coherent layouts and readable controls. The selected evidence is published by the integrator alongside the release.

## Findings, fixes and regressions

| Priority | Confirmed issue                                                                                       | Resolution and retained evidence                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| P2       | Small informational text failed AA contrast in desktop and mobile Axe scans.                          | Darker informational colors preserve the design; final scans pass.                                                    |
| P2       | The mobile Reset button lost its accessible name when its visible label was hidden.                   | A persistent accessible label remains; mobile Axe passes.                                                             |
| P2       | The brand's custom accessible name excluded its visible subtitle.                                     | The incomplete custom label was removed; RU/EN Axe passes.                                                            |
| P3       | A graph title could imply individual latencies although the values are cumulative means.              | RU/EN explicitly labels mean first-delivery latency.                                                                  |
| P3       | Disabling CSS transitions did not stop React-driven packet movement.                                  | Moving particles are hidden under reduced motion; the regression creates real flights and verifies their suppression. |
| P3       | Replay could preserve retry without ACK while controls implied or enforced a different configuration. | Blind retry is explicitly supported and bounded; the import/run regression verifies the actual result.                |

Outcome failure wording now distinguishes missing ACK confirmation from undelivered messages. The passing scenario regression compares the outcome table's failure labels and counts with the model. Packet-copy labels include ACK copies, and DATA attempt wording includes attempts rejected by the queue.

## Limits of the evidence

The product is a finite, seeded **discrete-event simulation**, not a real network measurement, packet analyzer or RFC-compatible TCP implementation. Finite retry budgets cannot guarantee delivery, and receiver deduplication lasts only for this run. The audit does not test actual networking, durable recovery, TCP congestion control, a backend or distributed machines because the product implements none of these.

Axe checks and Chromium screenshots supplement source and interaction review; Firefox, Safari, assistive-technology combinations and every valid parameter combination have not been exhaustively tested. Replay requires the same configuration and model version. The release check must compare the live full SHA with the tested commit.
