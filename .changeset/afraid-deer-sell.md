---
'signalium': major
---

Signalium v2 – docs overhaul, async-focused polish, and packaging improvements.

- New: `notifier()` API for manual invalidation (`consume()`/`notify()`), with tests and docs
- Docs: comprehensive refresh (consistent capitalization/terminology, fixed local anchors, advanced guides, normalized “side-effect”), new README with quickstart, and prominent `signalium.dev` link
- Packaging: publish only built artifacts (no `src/`/tests); add legacy CJS shims for `react.js`, `transform.js`, `debug.js`, `utils.js`, and `config.js` via a prepublish script; ensure `exports` map and types for subpaths
- Misc: refined description/tagline and repo metadata
