/**
 * Compile-time constant that indicates whether the code is running in development mode.
 * In development builds, this is `true` and enables additional debugging features.
 * In production builds, this is `false` and all code guarded by `if (IS_DEV)` is stripped.
 */
declare const IS_DEV: boolean;
