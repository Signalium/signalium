---
"fetchium": patch
---

Export `TypeDefSymbol` so downstream consumers can emit `.d.ts` files without TS4029 errors when using `TypeDef<T>` in public type positions, such as when extending `Entity`.
