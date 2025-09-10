export const unreachable = (value: never) => {
  throw new Error(`Unreachable code: ${value}`);
};

const GeneratorResultConstructor = (function* () {})().constructor;

export function isGeneratorResult(value: object): value is Generator {
  return value.constructor === GeneratorResultConstructor;
}

export function isPromise(value: object): value is Promise<unknown> {
  return value.constructor === Promise;
}
