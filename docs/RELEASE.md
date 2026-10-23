# PACKETLAB 1.0.0

An interactive laboratory for reliable message delivery in an unreliable **simulated** channel.

[Launch PACKETLAB](https://seoshiro.github.io/packetlab/)

Four reproducible experiments explore naive delivery, retry storms, exponential backoff with equal jitter, and deduplication/idempotency. Pause and step through deterministic events, change channel conditions, inspect receiver effects, and export/import a strictly validated versioned replay.

The pure TypeScript simulation core is separate from React. DATA and ACK use bounded directional FIFO queues, seeded loss/duplication, finite retry budgets and explicit safety limits. Metrics describe simulated messages and model time. This is not a network analyzer or an RFC-compatible TCP implementation.

RU/EN, responsive desktop/mobile layouts, keyboard controls, reduced motion, visible text state, message outcome tables, chart data tables and replay errors are included. The app runs entirely client-side, without accounts, secrets, paid APIs, external fonts or analytics.

See the [README](https://github.com/seoshiro/packetlab/blob/v1.0.0/README.md) for the mathematical model, exact metric definitions, fixed preset outcomes and limitations; see the [independent audit](https://github.com/seoshiro/packetlab/blob/v1.0.0/docs/AUDIT.md) for verification evidence. The deployed footer exposes its full source commit SHA for release verification.

MIT licensed.
