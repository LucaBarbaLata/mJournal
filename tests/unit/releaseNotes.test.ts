import { describe, expect, it } from 'vitest';
import { parseInline, parseReleaseNotes, plainText, type Block } from '@core/releaseNotes';

/** The blocks as short strings, to compare at a glance. */
function outline(blocks: Block[]): string[] {
  return blocks.flatMap((block): string[] => {
    switch (block.kind) {
      case 'heading':
        return [`h${block.level} ${plainText(block.content)}`];
      case 'paragraph':
        return [`p ${plainText(block.content)}`];
      case 'quote':
        return [`> ${plainText(block.content)}`];
      case 'code':
        return [`code ${block.text}`];
      case 'list': {
        const lines: string[] = [];
        const walk = (list: typeof block, depth: number) =>
          list.items.forEach((item, index) => {
            lines.push(`${'  '.repeat(depth)}${list.ordered ? `${list.start + index}.` : '-'} ${plainText(item.content)}`);
            if (item.sublist) walk(item.sublist, depth + 1);
          });
        walk(block, 0);
        return lines;
      }
    }
  });
}

describe('release notes', () => {
  it('reads headings, paragraphs and lists, joining wrapped lines', () => {
    const notes = [
      '## What’s new',
      '',
      '**mJournal now runs on Linux.** Two downloads for',
      '64-bit computers:',
      '- `mjournal_1.1.0_amd64.deb` installs mJournal',
      '- `mJournal-1.1.0.AppImage` runs on most',
      '  other distributions',
      '',
      '1. First',
      '2. Second',
      '   - nested',
      '',
      '> A quote',
      '> on two lines',
      '',
      '```',
      'code stays as it is',
      '```',
    ].join('\r\n');
    expect(outline(parseReleaseNotes(notes))).toEqual([
      'h2 What’s new',
      'p mJournal now runs on Linux. Two downloads for 64-bit computers:',
      '- mjournal_1.1.0_amd64.deb installs mJournal',
      '- mJournal-1.1.0.AppImage runs on most other distributions',
      '1. First',
      '2. Second',
      '  - nested',
      '> A quote on two lines',
      'code code stays as it is',
    ]);
  });

  it('leaves out the VirusTotal links, new contributors and the Full Changelog link', () => {
    const notes = [
      '<!-- Release notes generated using configuration in .github/release.yml -->',
      '## What’s Changed',
      '* Faster search by @someone in https://github.com/LucaBarbaLata/mJournal/pull/7',
      '',
      '## New Contributors',
      '* @someone made their first contribution in https://github.com/LucaBarbaLata/mJournal/pull/7',
      '',
      '**Full Changelog**: https://github.com/LucaBarbaLata/mJournal/compare/v1.2.0...v1.2.1',
      '',
      '',
      '## VirusTotal scans',
      '',
      '- [mJournal-Setup-1.2.1.exe](https://www.virustotal.com/gui/file/ae28)',
      '### Even deeper',
      'still hidden',
    ].join('\n');
    expect(outline(parseReleaseNotes(notes))).toEqual([
      'h2 What’s Changed',
      '- Faster search by @someone in https://github.com/LucaBarbaLata/mJournal/pull/7',
    ]);
  });

  it('is empty when only GitHub’s additions are there, headings included', () => {
    const notes =
      '**Full Changelog**: https://github.com/LucaBarbaLata/mJournal/compare/v1.1.4...v1.1.5\n\n\n## VirusTotal scans\n\n- [a.exe](https://x)\n';
    expect(parseReleaseNotes(notes)).toEqual([]);
    expect(parseReleaseNotes('## Fixes\n\n## Also nothing\n')).toEqual([]);
    expect(parseReleaseNotes('')).toEqual([]);
  });

  it('shows links as their text, leaves images out and never keeps HTML', () => {
    expect(parseInline('See [the guide](https://example.com/a_(b)) and ![shot](https://example.com/i.png)now')).toEqual([
      { kind: 'text', text: 'See the guide and now' },
    ]);
    expect(plainText(parseInline('Line<br>break <details><summary>More</summary></details> <https://example.com>'))).toBe(
      'Line break More https://example.com',
    );
    // Tags go; what's left is shown as text, never run.
    expect(outline(parseReleaseNotes('<script>alert(1)</script> Hello'))).toEqual(['p alert(1) Hello']);
  });

  it('reads bold, italics, strikethrough and code, and leaves other stars and underscores alone', () => {
    expect(parseInline('**bold** and *italic* and _also_ and ~~gone~~ and `a*b*c`')).toEqual([
      { kind: 'strong', children: [{ kind: 'text', text: 'bold' }] },
      { kind: 'text', text: ' and ' },
      { kind: 'em', children: [{ kind: 'text', text: 'italic' }] },
      { kind: 'text', text: ' and ' },
      { kind: 'em', children: [{ kind: 'text', text: 'also' }] },
      { kind: 'text', text: ' and ' },
      { kind: 'strike', children: [{ kind: 'text', text: 'gone' }] },
      { kind: 'text', text: ' and ' },
      { kind: 'code', text: 'a*b*c' },
    ]);
    expect(parseInline('***both***')).toEqual([{ kind: 'strong', children: [{ kind: 'em', children: [{ kind: 'text', text: 'both' }] }] }]);
    expect(parseInline('*a **b** c*')).toEqual([
      {
        kind: 'em',
        children: [
          { kind: 'text', text: 'a ' },
          { kind: 'strong', children: [{ kind: 'text', text: 'b' }] },
          { kind: 'text', text: ' c' },
        ],
      },
    ]);
    for (const text of ['2 * 3 * 4', 'pending_update_file', 'an *unclosed star', 'snake_case and a_b', '\\*not italic\\*', '@dependabot[bot]']) {
      expect(parseInline(text).every((part) => part.kind === 'text')).toBe(true);
    }
    expect(plainText(parseInline('\\*not italic\\*'))).toBe('*not italic*');
  });

  it('drops task-list boxes and empty items', () => {
    expect(outline(parseReleaseNotes('- [x] Done\n- [ ] To do\n- \n- ![only an image](https://x)'))).toEqual(['- Done', '- To do']);
  });
});
