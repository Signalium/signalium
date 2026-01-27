---
"@signalium/query": patch
---

Fix infinite query cache hydration and Hermes Uint32Array compatibility

- Fix Hermes (React Native) compatibility by spreading Set to Array before Uint32Array conversion, which prevents empty refIds buffers
- Fix infinite query cache loading by properly handling the array of pages when parsing entities, ensuring entity proxies resolve correctly after app restart
