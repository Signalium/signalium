import type { NodePath, PluginObj, types as t } from '@babel/core';
import { createTransformedImports, isBabelApi } from './utils.js';

export interface SignaliumUseReactiveTransformOptions {
  transformedImports: [string, string | RegExp][];
  importPaths?: (string | RegExp)[];
  reactImportPath?: string;
}

/**
 * Wraps the thunk argument of `useReactive` / `useReactiveDeep` in
 * `React.useCallback(fn, [deps])`. The captured identifiers are collected from
 * the thunk body the same way the `callback` transform does for `reactive()`
 * callbacks, giving the hook a stable identity across renders when captures are
 * equal. This lets the runtime reuse the underlying `ReactiveSignal`.
 *
 * Runs after the async and callback transforms so the inner function has
 * already been rewritten (e.g. `async` → `function*`).
 */
function createSignaliumUseReactiveTransform(api: any, opts?: SignaliumUseReactiveTransformOptions): PluginObj {
  // Only forward user-provided `transformedImports` entries that target the
  // hook names we care about. The shared `transformedImports` preset option is
  // also used by the callback/async transforms to retarget arbitrary identifiers
  // like `reactive`/`task`/`relay`; we must not accidentally pick those up here
  // or we'd wrap inner arrows with `useCallback` in non-React code paths.
  const trackedNames = new Set(['useReactive', 'useReactiveShallow', 'useReactiveDeep']);
  const filteredAdditional = opts?.transformedImports?.filter(([name]) => trackedNames.has(name));

  const transformedImports = createTransformedImports(
    [
      ['useReactive', ['signalium/react']],
      ['useReactiveShallow', ['signalium/react']],
      ['useReactiveDeep', ['signalium/react']],
    ],
    filteredAdditional,
    opts?.importPaths,
  );

  const t = api.types;
  const reactImportPath = opts?.reactImportPath ?? 'react';

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

  const isTargetCall = (path: NodePath<t.CallExpression>) => {
    const callee = path.node.callee;
    if (!t.isIdentifier(callee)) return false;
    return isTrackedImport((callee as t.Identifier).name, path);
  };

  function isIdentifierInTypePosition(refPath: NodePath<t.Identifier>): boolean {
    let current: NodePath | null = refPath.parentPath;
    let child: NodePath = refPath;
    while (current) {
      const nodeType = (current.node as any).type as string | undefined;
      if (nodeType && nodeType.startsWith('TS')) {
        if (
          current.isTSAsExpression() ||
          (current as any).isTSSatisfiesExpression?.() ||
          current.isTSNonNullExpression() ||
          (current as any).isTSInstantiationExpression?.()
        ) {
          if (child.key === 'expression') return false;
          return true;
        }
        return true;
      }
      child = current;
      current = current.parentPath;
    }
    return false;
  }

  function ensureUseCallbackIdentifier(programPath: NodePath<t.Program>): string {
    // Find an existing `import { useCallback as X } from 'react'`
    for (const bodyPath of programPath.get('body')) {
      if (!bodyPath.isImportDeclaration()) continue;
      const importDecl = bodyPath.node as t.ImportDeclaration;
      if (importDecl.source.value !== reactImportPath) continue;
      for (const spec of importDecl.specifiers) {
        if ((spec as any).type !== 'ImportSpecifier') continue;
        const ispec = spec as unknown as t.ImportSpecifier;
        const imported = ispec.imported as t.Identifier;
        if (imported && imported.name === 'useCallback') {
          return (ispec.local as t.Identifier).name;
        }
      }
    }

    // Augment an existing `import ... from 'react'`
    for (const bodyPath of programPath.get('body')) {
      if (!bodyPath.isImportDeclaration()) continue;
      const node = bodyPath.node as t.ImportDeclaration;
      if (node.source.value !== reactImportPath) continue;
      const localName = programPath.scope.generateUidIdentifier('useCallback').name;
      node.specifiers.push(t.importSpecifier(t.identifier(localName), t.identifier('useCallback')));
      return localName;
    }

    // Otherwise, insert a new import
    const localName = programPath.scope.generateUidIdentifier('useCallback').name;
    const importDecl = t.importDeclaration(
      [t.importSpecifier(t.identifier(localName), t.identifier('useCallback'))],
      t.stringLiteral(reactImportPath),
    );

    const [first] = programPath.get('body');
    if (first) {
      first.insertBefore(importDecl);
    } else {
      programPath.pushContainer('body', importDecl);
    }

    return localName;
  }

  function collectDeps(innerFn: NodePath<t.FunctionExpression> | NodePath<t.ArrowFunctionExpression>): string[] {
    const depNames = new Set<string>();
    const innerScope = innerFn.scope;
    const innerNode = innerFn.node as t.Function;
    innerFn.traverse({
      ReferencedIdentifier(refPath) {
        const nearestFn = refPath.getFunctionParent();
        if (!nearestFn || (nearestFn as any).node !== innerNode) return;

        const name = refPath.node.name;
        const binding = refPath.scope.getBinding(name);
        if (!binding) return;

        if (isIdentifierInTypePosition(refPath as unknown as NodePath<t.Identifier>)) return;

        if (binding.scope.path.isProgram()) return;

        let declScope: any = binding.scope;
        while (declScope) {
          if (declScope === innerScope) return;
          declScope = declScope.parent;
        }

        if (binding.kind === 'param' && binding.scope === innerScope) return;

        depNames.add(name);
      },
    });
    return Array.from(depNames);
  }

  function isAlreadyMemoized(argPath: NodePath): boolean {
    if (!argPath.isCallExpression()) return false;
    const callee = argPath.node.callee;
    if (!t.isIdentifier(callee)) return false;
    const name = (callee as t.Identifier).name;
    // Heuristic: any identifier ending in `useCallback` or `useMemo` is treated
    // as already-memoized. Avoids double-wrapping and supports aliased imports.
    return name === 'useCallback' || name === 'useMemo' || /useCallback$/.test(name);
  }

  return {
    name: 'signalium-transform-use-reactive',
    visitor: {
      CallExpression(callPath: NodePath<t.CallExpression>) {
        if (!isTargetCall(callPath)) return;

        const args = callPath.get('arguments');
        // Only the thunk form: exactly one argument and it is a function.
        if (args.length !== 1) return;

        let fnPath: NodePath = args[0];
        // Unwrap TS expression wrappers (`as`, `satisfies`, `!`, etc.) so the
        // user can still write `useReactive((async () => ...) as X)`.
        while (
          fnPath.isTSAsExpression() ||
          (fnPath as any).isTSSatisfiesExpression?.() ||
          fnPath.isTSNonNullExpression() ||
          (fnPath as any).isTSInstantiationExpression?.()
        ) {
          fnPath = fnPath.get('expression') as NodePath;
        }
        if (!(fnPath.isArrowFunctionExpression() || fnPath.isFunctionExpression())) return;
        if (isAlreadyMemoized(fnPath)) return;

        const programPath = callPath.findParent((p: NodePath) => p.isProgram()) as NodePath<t.Program>;
        const useCallbackName = ensureUseCallbackIdentifier(programPath);

        const innerFn = fnPath as NodePath<t.FunctionExpression> | NodePath<t.ArrowFunctionExpression>;
        const deps = collectDeps(innerFn);

        const wrapped = t.callExpression(t.identifier(useCallbackName), [
          innerFn.node as t.Expression,
          t.arrayExpression(deps.map(n => t.identifier(n))),
        ]);

        fnPath.replaceWith(wrapped);
        fnPath.skip();
      },
    },
  };
}

export function signaliumUseReactiveTransform(api: any, opts?: SignaliumUseReactiveTransformOptions): PluginObj;
export function signaliumUseReactiveTransform(opts?: SignaliumUseReactiveTransformOptions): (api: any) => PluginObj;
export function signaliumUseReactiveTransform(
  apiOrOpts?: any | SignaliumUseReactiveTransformOptions,
  maybeOpts?: SignaliumUseReactiveTransformOptions,
): ((api: any) => PluginObj) | PluginObj {
  if (isBabelApi(apiOrOpts)) {
    return createSignaliumUseReactiveTransform(apiOrOpts as any, maybeOpts);
  }
  return (api: any) =>
    createSignaliumUseReactiveTransform(api, apiOrOpts as SignaliumUseReactiveTransformOptions | undefined);
}
