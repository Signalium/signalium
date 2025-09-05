import type { NodePath, PluginObj, types as t } from '@babel/core';

export interface SignaliumPromiseMethodsTransformOptions {
  transformedImports: [string, string | RegExp][];
}

const PROMISE_STATIC_METHODS = new Set(['all', 'race', 'any', 'allSettled', 'resolve', 'reject', 'withResolvers']);

export function signaliumPromiseMethodsTransform(
  opts?: SignaliumPromiseMethodsTransformOptions,
): (api: any) => PluginObj {
  const transformedImports: Record<string, [string | RegExp]> = {
    callback: ['signalium'],
    reactive: ['signalium'],
    reactiveMethod: ['signalium'],
    relay: ['signalium'],
    task: ['signalium'],
  };

  for (const [name, path] of opts?.transformedImports ?? []) {
    const existing = transformedImports[name];

    if (existing) {
      existing.push(path);
    } else {
      transformedImports[name] = [path];
    }
  }

  return api => {
    const t = api.types as typeof import('@babel/types');

    const isReactiveCall = (path: NodePath<any>) => {
      if (!t.isCallExpression(path.node)) return false;
      const callee = path.node.callee;
      if (!t.isIdentifier(callee)) return false;

      // Resolve binding for the local identifier (may be aliased)
      const binding = path.scope.getBinding(callee.name);
      if (!binding || !t.isImportSpecifier(binding.path.node)) return false;

      const importSpec = binding.path.node;
      const imported = (importSpec.imported as t.Identifier).name;
      const importDecl = binding.path.parent;
      if (!t.isImportDeclaration(importDecl)) return false;

      const importPaths = transformedImports[imported];
      if (!importPaths) return false;

      return importPaths.some(p =>
        typeof p === 'string' ? importDecl.source.value === p : p.test(importDecl.source.value),
      );
    };

    const isWithinTrackedCall = (path: NodePath) => {
      let current: NodePath | null = path.parentPath;
      while (current) {
        if (current.isCallExpression() && isReactiveCall(current as any)) return true;
        current = current.parentPath;
      }
      return false;
    };

    function ensureReactivePromiseIdentifier(programPath: NodePath<t.Program>): t.Identifier {
      // Try to find an existing direct import: import { ReactivePromise as X } from 'signalium'
      for (const bodyPath of programPath.get('body')) {
        if (!bodyPath.isImportDeclaration()) continue;
        const importDecl = bodyPath.node as t.ImportDeclaration;
        if (importDecl.source.value !== 'signalium') continue;
        for (const spec of importDecl.specifiers) {
          if ((spec as any).type === 'ImportSpecifier') {
            const ispec = spec as unknown as t.ImportSpecifier;
            const imported = ispec.imported as t.Identifier;
            if (imported && (imported as any).name === 'ReactivePromise') {
              return t.identifier((ispec.local as t.Identifier).name);
            }
          }
        }
      }

      // Try to augment an existing import from 'signalium'
      for (const bodyPath of programPath.get('body')) {
        if (!bodyPath.isImportDeclaration()) continue;
        const node = bodyPath.node as t.ImportDeclaration;
        if (node.source.value !== 'signalium') continue;
        // Prefer non-aliased local name
        const localName = 'ReactivePromise';
        node.specifiers.push(t.importSpecifier(t.identifier(localName), t.identifier('ReactivePromise')));
        return t.identifier(localName);
      }

      // Otherwise, insert a new import from 'signalium'
      const localName = 'ReactivePromise';
      const importDecl = t.importDeclaration(
        [t.importSpecifier(t.identifier(localName), t.identifier('ReactivePromise'))],
        t.stringLiteral('signalium'),
      );

      const [first] = programPath.get('body');
      if (first) {
        first.insertBefore(importDecl);
      } else {
        programPath.pushContainer('body', importDecl);
      }

      return t.identifier(localName);
    }

    return {
      name: 'transform-reactive-promise-methods',
      visitor: {
        CallExpression(callPath) {
          // Only transform within Signalium tracked calls
          if (!isWithinTrackedCall(callPath)) return;

          const callee = callPath.node.callee;
          if (!t.isMemberExpression(callee)) return;
          if (callee.computed) return; // Promise['all'] etc. – skip to be conservative

          const object = callee.object;
          const property = callee.property;

          if (!t.isIdentifier(object, { name: 'Promise' })) return;
          // Ensure we are referring to the global Promise, not a local binding
          if (callPath.scope.getBinding('Promise')) return;

          if (!t.isIdentifier(property)) return;
          const methodName = property.name;
          if (!PROMISE_STATIC_METHODS.has(methodName)) return;

          // Ensure import exists and replace with <ReactivePromise>.<method>
          const programPath = callPath.findParent(p => p.isProgram()) as NodePath<t.Program>;
          const reactivePromiseId = ensureReactivePromiseIdentifier(programPath);
          const newCallee = t.memberExpression(reactivePromiseId, t.identifier(methodName));
          callPath.node.callee = newCallee;
        },
      },
    };
  };
}
