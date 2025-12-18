import type { ConfigAPI, NodePath, PluginObj, types as t } from '@babel/core';
import { createTransformedImports, isBabelApi } from './utils.js';

export interface SignaliumCallbackTransformOptions {
  transformedImports: [string, string | RegExp][];
  importPaths?: (string | RegExp)[];
  callbackImportPath?: string;
}

function createSignaliumCallbackTransform(api: any, opts?: SignaliumCallbackTransformOptions) {
  const transformedImports = createTransformedImports(
    [
      ['component', ['signalium/react']],
      ['reactive', ['signalium']],
      ['reactiveMethod', ['signalium']],
      ['relay', ['signalium']],
      ['task', ['signalium']],
    ],

    opts?.transformedImports,
    opts?.importPaths,
  );

  const t = api.types;
  const callbackImportPath = opts?.callbackImportPath ?? 'signalium';

  const isTrackedImport = (localName: string, path: NodePath<any>): false | string => {
    const binding = path.scope.getBinding(localName);
    if (!binding || !t.isImportSpecifier(binding.path.node)) return false;

    const importSpec = binding.path.node as t.ImportSpecifier;
    const importedName = (importSpec.imported as t.Identifier).name;
    const importDecl = binding.path.parent as t.ImportDeclaration;
    if (!t.isImportDeclaration(importDecl)) return false;

    const importPaths = transformedImports.get(importedName);
    if (!importPaths) return false;

    const matches = importPaths.find(p =>
      typeof p === 'string' ? importDecl.source.value === p : p.test(importDecl.source.value),
    );

    return matches ? (typeof matches === 'string' ? matches : importDecl.source.value) : false;
  };

  const isTargetWrapperCall = (path: NodePath<any>) => {
    if (!t.isCallExpression(path.node)) return false;
    const callee = path.node.callee;
    if (!t.isIdentifier(callee)) return false;
    return !!isTrackedImport(callee.name, path);
  };

  function isIdentifierInTypePosition(refPath: NodePath<t.Identifier>): boolean {
    // Walk up ancestors and detect if the identifier is within TS type-only constructs
    // Allow identifiers inside the expression arm of TS* expression wrappers
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
          // If we reached this TS* expression via its 'expression' arm, it's runtime, not type-only
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

  function ensureCallbackIdentifier(programPath: NodePath<t.Program>): string {
    // Try to find an existing direct import: import { callback as X } from 'signalium'
    for (const bodyPath of programPath.get('body')) {
      if (!bodyPath.isImportDeclaration()) continue;
      const importDecl = bodyPath.node as t.ImportDeclaration;
      if (importDecl.source.value !== callbackImportPath) continue;
      for (const spec of importDecl.specifiers) {
        if ((spec as any).type === 'ImportSpecifier') {
          const ispec = spec as unknown as t.ImportSpecifier;
          const imported = ispec.imported as t.Identifier;
          if (imported && (imported as any).name === 'callback') {
            return (ispec.local as t.Identifier).name;
          }
        }
      }
    }

    // Try to augment an existing import from 'signalium'
    for (const bodyPath of programPath.get('body')) {
      if (!bodyPath.isImportDeclaration()) continue;
      const node = bodyPath.node as t.ImportDeclaration;
      if (node.source.value !== callbackImportPath) continue;
      const localName = programPath.scope.generateUidIdentifier('callback').name;
      node.specifiers.push(t.importSpecifier(t.identifier(localName), t.identifier('callback')));
      return localName;
    }

    // Otherwise, insert a new import from 'signalium'
    const localName = 'callback';
    const importDecl = t.importDeclaration(
      [t.importSpecifier(t.identifier(localName), t.identifier('callback'))],
      t.stringLiteral(callbackImportPath),
    );

    const [first] = programPath.get('body');
    if (first) {
      first.insertBefore(importDecl);
    } else {
      programPath.pushContainer('body', importDecl);
    }

    return localName;
  }

  function collectDeps(
    innerFn: NodePath<t.FunctionExpression> | NodePath<t.ArrowFunctionExpression> | NodePath<t.FunctionDeclaration>,
  ) {
    const depNames = new Set<string>();
    const innerScope = innerFn.scope;
    const innerNode = innerFn.node as t.Function;
    innerFn.traverse({
      ReferencedIdentifier(refPath) {
        // Only consider refs whose nearest function parent is the inner function
        const nearestFn = refPath.getFunctionParent();
        if (!nearestFn || (nearestFn as any).node !== innerNode) return;

        const name = refPath.node.name;
        const binding = refPath.scope.getBinding(name);
        if (!binding) return;

        // Ignore identifiers that appear only in type positions
        if (isIdentifierInTypePosition(refPath as unknown as NodePath<t.Identifier>)) return;

        // Exclude module scope
        if (binding.scope.path.isProgram()) return;

        // Exclude identifiers declared within the inner function itself or any nested scope inside it
        let declScope: any = binding.scope;
        while (declScope) {
          if (declScope === innerScope) return;
          declScope = declScope.parent;
        }

        // Exclude only the inner function's own parameters
        if (binding.kind === 'param' && binding.scope === innerScope) return;

        depNames.add(name);
      },
    });
    return depNames;
  }

  return {
    name: 'signalium-transform-callback-wrapping',
    visitor: {
      CallExpression(callPath: NodePath<t.CallExpression>) {
        if (!isTargetWrapperCall(callPath)) return;

        const arg0 = callPath.get('arguments')[0] as NodePath | undefined;
        if (!arg0) return;
        if (!(arg0.isFunctionExpression() || arg0.isArrowFunctionExpression())) return;

        const outerFn = arg0 as NodePath<t.FunctionExpression | t.ArrowFunctionExpression>;
        const programPath = callPath.findParent((p: NodePath) => p.isProgram()) as NodePath<t.Program>;
        const callbackName = ensureCallbackIdentifier(programPath);

        // Maintain per-function counters
        const counters = new WeakMap<object, number>();
        counters.set(outerFn.node as unknown as object, 0);

        const getNextIndexFor = (fnNode: object) => {
          const current = counters.get(fnNode) ?? 0;
          counters.set(fnNode, current + 1);
          return current;
        };

        outerFn.traverse({
          // Initialize counters for any function-like node when first seen
          FunctionExpression: {
            enter(fnPath) {
              if (!counters.has(fnPath.node as unknown as object)) counters.set(fnPath.node as unknown as object, 0);
            },
            exit(innerFnPath) {
              if (innerFnPath.node === outerFn.node) return;
              // Skip converting when the function is passed directly as a callback
              // to a tracked call AND that call is nested within another tracked call.
              const immediateParent = innerFnPath.parentPath;
              if (immediateParent && immediateParent.isCallExpression()) {
                const callee = immediateParent.node.callee;
                if (t.isIdentifier(callee)) {
                  const calleeId = callee as unknown as t.Identifier;
                  if (isTrackedImport(calleeId.name, immediateParent as any)) {
                    let current: NodePath | null = immediateParent.parentPath;
                    while (current) {
                      if (current.isCallExpression()) {
                        const parentCallee = (current.node as t.CallExpression).callee;
                        if (t.isIdentifier(parentCallee)) {
                          const parentCalleeId = parentCallee as unknown as t.Identifier;
                          if (isTrackedImport(parentCalleeId.name, current as any)) {
                            return; // nested direct callback – skip
                          }
                        }
                      }
                      current = current.parentPath;
                    }
                  }
                }
              }
              // Skip if already wrapped in callback()
              const parent = innerFnPath.parentPath;
              if (parent && parent.isCallExpression()) {
                const callee = parent.node.callee;
                if (t.isIdentifier(callee)) {
                  const calleeId = callee as unknown as t.Identifier;
                  if (calleeId.name === callbackName) {
                    return;
                  }
                }
              }
              const deps = Array.from(collectDeps(innerFnPath as NodePath<t.FunctionExpression>));
              // Determine parent function to index against
              const parentFn = (innerFnPath.parentPath?.getFunctionParent() || outerFn) as NodePath<any>;
              const argIndex = getNextIndexFor(parentFn.node as unknown as object);
              const args = [innerFnPath.node as t.Expression, t.numericLiteral(argIndex)] as t.Expression[];
              if (deps.length > 0) {
                args.push(t.arrayExpression(deps.map(n => t.identifier(n))));
              }
              const wrapped = t.callExpression(t.identifier(callbackName), args);
              innerFnPath.replaceWith(wrapped);
              innerFnPath.skip();
            },
          },
          ArrowFunctionExpression: {
            enter(fnPath) {
              if (!counters.has(fnPath.node as unknown as object)) counters.set(fnPath.node as unknown as object, 0);
            },
            exit(innerFnPath) {
              if (innerFnPath.node === outerFn.node) return;
              // Skip converting when the function is passed directly as a callback
              // to a tracked call AND that call is nested within another tracked call.
              const immediateParent = innerFnPath.parentPath;
              if (immediateParent && immediateParent.isCallExpression()) {
                const callee = immediateParent.node.callee;
                if (t.isIdentifier(callee)) {
                  const calleeId = callee as unknown as t.Identifier;
                  if (isTrackedImport(calleeId.name, immediateParent as any)) {
                    let current: NodePath | null = immediateParent.parentPath;
                    while (current) {
                      if (current.isCallExpression()) {
                        const parentCallee = (current.node as t.CallExpression).callee;
                        if (t.isIdentifier(parentCallee)) {
                          const parentCalleeId = parentCallee as unknown as t.Identifier;
                          if (isTrackedImport(parentCalleeId.name, current as any)) {
                            return; // nested direct callback – skip
                          }
                        }
                      }
                      current = current.parentPath;
                    }
                  }
                }
              }
              // Skip if already wrapped in callback()
              const parent = innerFnPath.parentPath;
              if (parent && parent.isCallExpression()) {
                const callee = parent.node.callee;
                if (t.isIdentifier(callee)) {
                  const calleeId = callee as unknown as t.Identifier;
                  if (calleeId.name === callbackName) {
                    return;
                  }
                }
              }
              const deps = Array.from(collectDeps(innerFnPath as NodePath<t.ArrowFunctionExpression>));
              const parentFn = (innerFnPath.parentPath?.getFunctionParent() || outerFn) as NodePath<any>;
              const argIndex = getNextIndexFor(parentFn.node as unknown as object);
              const args = [innerFnPath.node as t.Expression, t.numericLiteral(argIndex)] as t.Expression[];
              if (deps.length > 0) {
                args.push(t.arrayExpression(deps.map(n => t.identifier(n))));
              }
              const wrapped = t.callExpression(t.identifier(callbackName), args);
              innerFnPath.replaceWith(wrapped);
              innerFnPath.skip();
            },
          },
          FunctionDeclaration: {
            enter(fnPath) {
              if (!counters.has(fnPath.node as unknown as object)) counters.set(fnPath.node as unknown as object, 0);
            },
            exit(innerDeclPath) {
              const id = innerDeclPath.node.id;
              if (!id) return;

              const fnExpr = t.functionExpression(
                id,
                innerDeclPath.node.params,
                innerDeclPath.node.body,
                innerDeclPath.node.generator,
                innerDeclPath.node.async,
              );

              const deps = Array.from(collectDeps(innerDeclPath as unknown as NodePath<t.FunctionDeclaration>));

              const parentFn = (innerDeclPath.parentPath?.getFunctionParent() || outerFn) as NodePath<any>;
              const argIndex = getNextIndexFor(parentFn.node as unknown as object);
              const args = [fnExpr as t.Expression, t.numericLiteral(argIndex)] as t.Expression[];
              if (deps.length > 0) {
                args.push(t.arrayExpression(deps.map(n => t.identifier(n))));
              }
              const wrapped = t.callExpression(t.identifier(callbackName), args);

              const constDecl = t.variableDeclaration('const', [t.variableDeclarator(id, wrapped)]);
              innerDeclPath.replaceWith(constDecl);
              innerDeclPath.skip();
            },
          },
          ObjectMethod: {
            enter(fnPath) {
              if (!counters.has(fnPath.node as unknown as object)) counters.set(fnPath.node as unknown as object, 0);
            },
            exit(innerMethodPath) {
              if (innerMethodPath.node.kind !== 'method') return;
              const fnExpr = t.functionExpression(
                null,
                innerMethodPath.node.params,
                innerMethodPath.node.body,
                innerMethodPath.node.generator,
                innerMethodPath.node.async,
              );
              const deps = Array.from(collectDeps(innerMethodPath as unknown as NodePath<t.FunctionExpression>));
              const parentFn = (innerMethodPath.parentPath?.getFunctionParent() || outerFn) as NodePath<any>;
              const argIndex = getNextIndexFor(parentFn.node as unknown as object);
              const args = [fnExpr as t.Expression, t.numericLiteral(argIndex)] as t.Expression[];
              if (deps.length > 0) {
                args.push(t.arrayExpression(deps.map(n => t.identifier(n))));
              }
              const wrapped = t.callExpression(t.identifier(callbackName), args);

              const key = innerMethodPath.node.key;
              const computed = innerMethodPath.node.computed || false;
              const prop = t.objectProperty(key, wrapped, computed);
              innerMethodPath.replaceWith(prop);
              innerMethodPath.skip();
            },
          },
        });
      },
    },
  };
}

export function signaliumCallbackTransform(api: any, opts?: SignaliumCallbackTransformOptions): PluginObj;
export function signaliumCallbackTransform(opts?: SignaliumCallbackTransformOptions): (api: any) => PluginObj;
export function signaliumCallbackTransform(
  apiOrOpts: any | SignaliumCallbackTransformOptions,
  opts?: SignaliumCallbackTransformOptions,
): ((api: any) => PluginObj) | PluginObj {
  if (isBabelApi(apiOrOpts)) {
    return createSignaliumCallbackTransform(apiOrOpts, opts);
  } else {
    return (api: any) => createSignaliumCallbackTransform(api, apiOrOpts);
  }
}
