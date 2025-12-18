import type { NodePath, PluginObj, types as t } from '@babel/core';
import { createTransformedImports, isBabelApi } from './utils.js';

export interface SignaliumPromiseMethodsTransformOptions {
  transformedImports: [string, string | RegExp][];
  importPaths?: (string | RegExp)[];
  promiseImportPath?: string;
}

const PROMISE_STATIC_METHODS = new Set(['all', 'race', 'any', 'allSettled', 'resolve', 'reject', 'withResolvers']);

function createSignaliumPromiseMethodsTransform(api: any, opts?: SignaliumPromiseMethodsTransformOptions): PluginObj {
  const transformedImports = createTransformedImports(
    [
      ['callback', ['signalium']],
      ['reactive', ['signalium']],
      ['reactiveMethod', ['signalium']],
      ['relay', ['signalium']],
      ['task', ['signalium']],
    ],
    opts?.transformedImports,
    opts?.importPaths,
  );

  const t = api.types as typeof import('@babel/types');
  const promiseImportPath = opts?.promiseImportPath ?? 'signalium';

  const isTrackedImport = (localName: string, path: NodePath<any>): boolean => {
    const binding = path.scope.getBinding(localName);
    if (!binding || !t.isImportSpecifier(binding.path.node)) return false;
    const importSpec = binding.path.node as t.ImportSpecifier;
    const importedName = (importSpec.imported as t.Identifier).name;
    const importDecl = binding.path.parent as t.ImportDeclaration;
    if (!t.isImportDeclaration(importDecl)) return false;
    const importPaths = transformedImports.get(importedName);
    if (!importPaths) return false;
    return importPaths.some(p =>
      typeof p === 'string' ? importDecl.source.value === p : p.test(importDecl.source.value),
    );
  };

  const isReactiveCall = (path: NodePath<any>) => {
    if (!t.isCallExpression(path.node)) return false;
    const callee = path.node.callee;
    if (!t.isIdentifier(callee)) return false;
    return isTrackedImport(callee.name, path);
  };

  const isWithinTrackedCall = (path: NodePath) => {
    let current: NodePath | null = path.parentPath;
    while (current) {
      if (current.isCallExpression() && isReactiveCall(current as any)) return true;
      current = current.parentPath;
    }
    return false;
  };

  function ensureReactivePromiseIdentifier(programPath: NodePath<t.Program>): string {
    for (const bodyPath of programPath.get('body')) {
      if (!bodyPath.isImportDeclaration()) continue;
      const importDecl = bodyPath.node as t.ImportDeclaration;
      if (importDecl.source.value !== promiseImportPath) continue;
      for (const spec of importDecl.specifiers) {
        if ((spec as any).type === 'ImportSpecifier') {
          const ispec = spec as unknown as t.ImportSpecifier;
          const imported = ispec.imported as t.Identifier;
          if (imported && (imported as any).name === 'ReactivePromise') {
            return (ispec.local as t.Identifier).name;
          }
        }
      }
    }

    for (const bodyPath of programPath.get('body')) {
      if (!bodyPath.isImportDeclaration()) continue;
      const node = bodyPath.node as t.ImportDeclaration;
      if (node.source.value !== promiseImportPath) continue;
      const localName = 'ReactivePromise';
      node.specifiers.push(t.importSpecifier(t.identifier(localName), t.identifier('ReactivePromise')));
      return localName;
    }

    const localName = 'ReactivePromise';
    const importDecl = t.importDeclaration(
      [t.importSpecifier(t.identifier(localName), t.identifier('ReactivePromise'))],
      t.stringLiteral(promiseImportPath),
    );

    const [first] = programPath.get('body');
    if (first) {
      first.insertBefore(importDecl);
    } else {
      programPath.pushContainer('body', importDecl);
    }

    return localName;
  }

  return {
    name: 'signalium-transform-reactive-promise-methods',
    visitor: {
      CallExpression(callPath: NodePath<t.CallExpression>) {
        if (!isWithinTrackedCall(callPath)) return;

        const callee = callPath.node.callee;
        if (!t.isMemberExpression(callee)) return;
        if (callee.computed) return;

        const object = callee.object;
        const property = callee.property;

        if (!t.isIdentifier(object, { name: 'Promise' })) return;
        if (callPath.scope.getBinding('Promise')) return;

        if (!t.isIdentifier(property)) return;
        const methodName = property.name;
        if (!PROMISE_STATIC_METHODS.has(methodName)) return;

        const programPath = callPath.findParent((p: NodePath) => p.isProgram()) as NodePath<t.Program>;
        const reactivePromiseId = ensureReactivePromiseIdentifier(programPath);
        const newCallee = t.memberExpression(t.identifier(reactivePromiseId), t.identifier(methodName));
        callPath.node.callee = newCallee;
      },
    },
  };
}

export function signaliumPromiseMethodsTransform(api: any, opts?: SignaliumPromiseMethodsTransformOptions): PluginObj;
export function signaliumPromiseMethodsTransform(
  opts?: SignaliumPromiseMethodsTransformOptions,
): (api: any) => PluginObj;
export function signaliumPromiseMethodsTransform(
  apiOrOpts?: any | SignaliumPromiseMethodsTransformOptions,
  maybeOpts?: SignaliumPromiseMethodsTransformOptions,
): ((api: any) => PluginObj) | PluginObj {
  if (isBabelApi(apiOrOpts)) {
    return createSignaliumPromiseMethodsTransform(apiOrOpts as any, maybeOpts);
  }
  return (api: any) =>
    createSignaliumPromiseMethodsTransform(api, apiOrOpts as SignaliumPromiseMethodsTransformOptions | undefined);
}
