'use client';

import { Fragment } from 'react';
import { Highlight } from 'prism-react-renderer';
import clsx from 'clsx';
import { useMode } from './CodeSwitcher';

export function CodeFence({
  children,
  language = 'text',
  className: customClassName,
}: {
  children: string;
  language?: string;
  className?: string;
}) {
  return (
    <div className="relative">
      <div className="flex items-center gap-1.5 rounded-t-xl border border-b-0 border-primary-800 bg-primary-1000 px-4 py-2">
        <span className="h-2 w-2 rounded-full bg-tertiary-300/50" />
        <span className="h-2 w-2 rounded-full bg-secondary-300/50" />
        {language && language !== 'text' && (
          <span className="ml-2 text-xs text-primary-500">{language}</span>
        )}
      </div>
      <Highlight
        code={children.trimEnd()}
        language={language || 'text'}
        theme={{ plain: {}, styles: [] }}
      >
        {({ className, style, tokens, getTokenProps }) => (
          <pre
            className={clsx(
              className,
              customClassName,
              'mt-0! rounded-t-none! border-t-0!',
            )}
            style={style}
          >
            <code>
              {tokens.map((line, lineIndex) => (
                <Fragment key={lineIndex}>
                  {line
                    .filter((token) => !token.empty)
                    .map((token, tokenIndex) => (
                      <span key={tokenIndex} {...getTokenProps({ token })} />
                    ))}
                  {'\n'}
                </Fragment>
              ))}
            </code>
          </pre>
        )}
      </Highlight>
    </div>
  );
}

export function Fence({
  children,
  language,
  mode: fenceMode,
}: {
  children: string;
  language: string;
  mode?: 'react' | 'signalium';
}) {
  const { mode } = useMode();

  if (fenceMode && fenceMode !== mode) {
    return null;
  }

  return <CodeFence language={language}>{children}</CodeFence>;
}
