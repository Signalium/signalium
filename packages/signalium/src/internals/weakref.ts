class WeakRefPolyfill<T extends WeakKey> {
  constructor(private value: T) {}

  deref(): T {
    return this.value;
  }
}

export default typeof WeakRef === 'function' ? WeakRef : (WeakRefPolyfill as unknown as WeakRefConstructor);
