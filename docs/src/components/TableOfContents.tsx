'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';

import { type Section, type Subsection } from '@/lib/sections';

export function TableOfContents({
  tableOfContents,
}: {
  tableOfContents: Array<Section>;
}) {
  let [currentSection, setCurrentSection] = useState(tableOfContents[0]?.id);

  let getHeadings = useCallback((tableOfContents: Array<Section>) => {
    return tableOfContents
      .flatMap((node) => [node.id, ...node.children.map((child) => child.id)])
      .map((id) => {
        let el = document.getElementById(id);
        if (!el) return null;

        let style = window.getComputedStyle(el);
        let scrollMt = parseFloat(style.scrollMarginTop);

        let top = window.scrollY + el.getBoundingClientRect().top - scrollMt;
        return { id, top };
      })
      .filter((x): x is { id: string; top: number } => x !== null);
  }, []);

  useEffect(() => {
    if (tableOfContents.length === 0) return;
    let headings = getHeadings(tableOfContents);
    function onScroll() {
      let top = window.scrollY;
      let current = headings[0].id;
      for (let heading of headings) {
        if (top >= heading.top - 10) {
          current = heading.id;
        } else {
          break;
        }
      }
      setCurrentSection(current);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
    };
  }, [getHeadings, tableOfContents]);

  function isActive(section: Section | Subsection) {
    if (section.id === currentSection) {
      return true;
    }
    if (!section.children) {
      return false;
    }
    return section.children.findIndex(isActive) > -1;
  }

  return (
    <div className="hidden xl:sticky xl:top-14 xl:-mr-6 xl:block xl:h-[calc(100vh-3.5rem)] xl:flex-none xl:overflow-y-auto xl:py-8 xl:pr-6">
      <nav aria-labelledby="on-this-page-title" className="w-56">
        {tableOfContents.length > 0 && (
          <>
            <h2
              id="on-this-page-title"
              className="text-[11px] font-semibold tracking-wider text-primary-400 uppercase"
            >
              On this page
            </h2>
            <ol role="list" className="mt-4 space-y-3 text-sm">
              {tableOfContents.map((section) => (
                <li key={section.id}>
                  <h3>
                    <Link
                      href={`#${section.id}`}
                      className={clsx(
                        'block border-l-2 pl-3 transition-colors',
                        isActive(section)
                          ? 'border-tertiary-300 font-medium text-tertiary-300'
                          : 'border-transparent text-primary-300/70 hover:text-primary-100',
                      )}
                    >
                      {section.title}
                    </Link>
                  </h3>
                  {section.children.length > 0 && (
                    <ol
                      role="list"
                      className="mt-2 space-y-3 text-primary-300/70"
                    >
                      {section.children.map((subSection) => (
                        <li key={subSection.id}>
                          <Link
                            href={`#${subSection.id}`}
                            className={clsx(
                              'block border-l-2 pl-6 transition-colors',
                              isActive(subSection)
                                ? 'border-tertiary-300 font-medium text-tertiary-300'
                                : 'border-transparent hover:text-primary-100',
                            )}
                          >
                            {subSection.title}
                          </Link>
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
      </nav>
    </div>
  );
}
