/**
 * A release's notes, read by core/releaseNotes.ts, as ordinary React elements: nothing from GitHub becomes HTML, and
 * links are only their text.
 */
import type { ReactNode } from 'react';
import type { Block, Inline, ListBlock } from '@core/releaseNotes';

function inline(content: Inline[]): ReactNode[] {
  return content.map((part, index) => {
    switch (part.kind) {
      case 'text':
        return part.text;
      case 'code':
        return <code key={index}>{part.text}</code>;
      case 'strong':
        return <strong key={index}>{inline(part.children)}</strong>;
      case 'em':
        return <em key={index}>{inline(part.children)}</em>;
      case 'strike':
        return <s key={index}>{inline(part.children)}</s>;
    }
  });
}

function List({ list }: { list: ListBlock }) {
  const items = list.items.map((item, index) => (
    <li key={index}>
      {inline(item.content)}
      {item.sublist && <List list={item.sublist} />}
    </li>
  ));
  return list.ordered ? <ol start={list.start === 1 ? undefined : list.start}>{items}</ol> : <ul>{items}</ul>;
}

/**
 * `headingLevel` is the level the notes' own top headings get, so they fit under the headings around them (the notes'
 * smaller headings get the level below it).
 */
export function ReleaseNotes({ blocks, headingLevel }: { blocks: Block[]; headingLevel: 3 | 4 }) {
  return (
    <div className="release-notes">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'heading': {
            const Heading = block.level <= 2 ? (`h${headingLevel}` as const) : (`h${headingLevel + 1}` as 'h4' | 'h5');
            return (
              <Heading key={index} className={block.level <= 2 ? 'release-notes-heading' : 'release-notes-subheading'}>
                {inline(block.content)}
              </Heading>
            );
          }
          case 'paragraph':
            return <p key={index}>{inline(block.content)}</p>;
          case 'quote':
            return (
              <blockquote key={index}>
                <p>{inline(block.content)}</p>
              </blockquote>
            );
          case 'code':
            return (
              <pre key={index}>
                <code>{block.text}</code>
              </pre>
            );
          case 'list':
            return <List key={index} list={block} />;
        }
      })}
    </div>
  );
}
