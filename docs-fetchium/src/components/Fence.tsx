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
    <Highlight
      code={children.trimEnd()}
      language={language || 'text'}
      theme={{ plain: {}, styles: [] }}
    >
      {({ className, style, tokens, getTokenProps }) => (
        <pre className={clsx(className, customClassName)} style={style}>
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
