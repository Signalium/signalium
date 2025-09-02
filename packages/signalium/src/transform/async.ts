import type { NodePath, PluginObj, types as t } from '@babel/core';
import { createTransformedImports, isBabelApi } from './utils.js';

export interface SignaliumAsyncTransformOptions {
  transformedImports: [string, string | RegExp][];
  importPaths?: (string | RegExp)[];
}

function createSignaliumAsyncTransform(api: any, opts?: SignaliumAsyncTransformOptions): PluginObj {
  const transformedImports = createTransformedImports(
    [
      ['callback', ['signalium']],
      ['reactive', ['signalium']],
      ['reactiveMethod', ['signalium']],
      ['relay', ['signalium']],
      ['task', ['signalium']],
      ['watcher', ['signalium']],
    ],
    opts?.transformedImports,
    opts?.importPaths,
  );

  const t = api.types;

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

  function convertReactiveToGenerator(path: NodePath<t.FunctionExpression | t.ArrowFunctionExpression>) {
    if (!isWithinTrackedCall(path)) return;
    if (!path.node.async) return;

    path.traverse({
      AwaitExpression(awaitPath) {
        const funcParent = awaitPath.getFunctionParent();
        if (funcParent?.node !== path.node) return;
        awaitPath.replaceWith(t.yieldExpression(awaitPath.node.argument));
      },
    });

    path.node.async = false;

    if (t.isArrowFunctionExpression(path.node)) {
      let hasThis = false;
      path.traverse({
        ThisExpression() {
          hasThis = true;
        },
      });

      const functionBody = t.isBlockStatement(path.node.body)
        ? path.node.body
        : t.blockStatement([t.returnStatement(path.node.body)]);

      const newFunction = t.functionExpression(null, path.node.params, functionBody, true, false);

      if (hasThis) {
        path.replaceWith(t.callExpression(t.memberExpression(newFunction, t.identifier('bind')), [t.thisExpression()]));
      } else {
        path.replaceWith(newFunction);
      }
    } else {
      path.node.generator = true;
    }
  }

  return {
    name: 'signalium-transform-reactive-async',
    visitor: {
      FunctionExpression: convertReactiveToGenerator,
      ArrowFunctionExpression: convertReactiveToGenerator,
    },
  };
}

export function signaliumAsyncTransform(api: any, opts?: SignaliumAsyncTransformOptions): PluginObj;
export function signaliumAsyncTransform(opts?: SignaliumAsyncTransformOptions): (api: any) => PluginObj;
export function signaliumAsyncTransform(
  apiOrOpts?: any | SignaliumAsyncTransformOptions,
  maybeOpts?: SignaliumAsyncTransformOptions,
): ((api: any) => PluginObj) | PluginObj {
  if (isBabelApi(apiOrOpts)) {
    return createSignaliumAsyncTransform(apiOrOpts as any, maybeOpts);
  }
  return (api: any) => createSignaliumAsyncTransform(api, apiOrOpts as SignaliumAsyncTransformOptions | undefined);
}
