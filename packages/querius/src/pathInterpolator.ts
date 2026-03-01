/**
 * Path interpolation utilities for URL templates with parameter substitution.
 *
 * Converts path templates like "/users/{userId}/posts/{postId}" into functions
 * that efficiently interpolate parameter values.
 *
 * The implementation pre-parses the path template once into segments and parameter
 * keys, then uses simple string concatenation at runtime for optimal performance.
 */

export type PathInterpolator = (params: Record<string, any>) => string;

export interface PathInterpolatorResult {
  interpolate: PathInterpolator;
  pathParamNames: Set<string>;
}

/**
 * Creates an optimized path interpolation function from a URL template.
 *
 * The template uses curly braces for parameters (e.g., "/items/{id}").
 * Parameter values are URL-encoded when interpolated. Any parameters not
 * found in the path template are appended as query string parameters.
 *
 * @param pathTemplate - URL template with {paramName} placeholders
 * @returns Object with interpolate function and set of path param names
 *
 * @example
 * ```ts
 * const { interpolate } = createPathInterpolator('/users/{userId}/posts/{postId}');
 * const url = interpolate({ userId: '123', postId: '456', page: 2, limit: 10 });
 * // Returns: "/users/123/posts/456?page=2&limit=10"
 * ```
 */
export function createPathInterpolator(pathTemplate: string): PathInterpolatorResult {
  // Pre-parse path into segments and param keys (parse once, concatenate many times)
  const segments: string[] = [];
  const paramKeys: string[] = [];
  const paramKeysSet = new Set<string>();
  let lastIndex = 0;
  const paramRegex = /\[([^\]]+)\]/g;
  let match: RegExpExecArray | null;

  while ((match = paramRegex.exec(pathTemplate)) !== null) {
    segments.push(pathTemplate.slice(lastIndex, match.index));
    paramKeys.push(match[1]);
    paramKeysSet.add(match[1]);
    lastIndex = paramRegex.lastIndex;
  }
  segments.push(pathTemplate.slice(lastIndex));

  // Return optimized interpolation function with pre-parsed segments
  const interpolate = (params: Record<string, any>): string => {
    // Build the path with interpolated path parameters
    let result = segments[0];
    for (let i = 0; i < paramKeys.length; i++) {
      result += encodeURIComponent(String(params[paramKeys[i]])) + segments[i + 1];
    }

    // Collect remaining parameters as search params
    let searchParams: URLSearchParams | null = null;
    for (const key in params) {
      if (!paramKeysSet.has(key) && params[key] !== undefined) {
        if (searchParams === null) {
          searchParams = new URLSearchParams();
        }

        searchParams.append(key, String(params[key]));
      }
    }

    // Append search params if any exist
    if (searchParams !== null) {
      result += '?' + searchParams.toString();
    }

    return result;
  };

  return { interpolate, pathParamNames: paramKeysSet };
}
