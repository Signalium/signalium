import { type Node } from '@markdoc/markdoc';

import { DocsHeader } from '@/components/DocsHeader';
import { PrevNextLinks } from '@/components/PrevNextLinks';
import { Prose } from '@/components/Prose';
import { TableOfContents } from '@/components/TableOfContents';
import { collectSections } from '@/lib/sections';

export function DocsLayout({
  children,
  frontmatter: { title },
  nodes,
}: {
  children: React.ReactNode;
  frontmatter: { title?: string };
  nodes: Array<Node>;
}) {
  let tableOfContents = collectSections(nodes);

  return (
    <>
      <div className="max-w-2xl min-w-0 flex-auto px-6 py-10 lg:max-w-none lg:px-12 xl:px-16">
        <article>
          <DocsHeader title={title} />
          <Prose>{children}</Prose>
        </article>
        <PrevNextLinks />
      </div>
      <TableOfContents tableOfContents={tableOfContents} />
    </>
  );
}
