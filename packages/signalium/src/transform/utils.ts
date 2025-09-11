import { ConfigAPI } from '@babel/core';

export const isBabelApi = (value: unknown): value is ConfigAPI =>
  !!value && typeof value === 'object' && 'types' in value;

export const createTransformedImports = (
  defaultImports: [string, [string | RegExp]][],
  additionalImports?: [string, string | RegExp][],
  globalImportPaths?: (string | RegExp)[],
) => {
  if (globalImportPaths) {
    defaultImports.forEach(([name, paths]) => {
      paths.push(...globalImportPaths);
    });
  }

  const transformedImports = new Map(defaultImports);

  if (additionalImports && additionalImports.length > 0) {
    for (const [name, path] of additionalImports) {
      const existing = transformedImports.get(name);
      if (existing) {
        existing.push(path);
      } else {
        transformedImports.set(name, [path]);
      }
    }
  }

  return transformedImports;
};
