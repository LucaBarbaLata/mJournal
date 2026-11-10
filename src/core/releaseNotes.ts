/**
 * Reads a release's notes (GitHub's Markdown, see core/updates.ts) into simple blocks that "What's new" shows as
 * ordinary text: headings, paragraphs, lists, quotes and code. Nothing in them becomes HTML. Links are shown as their
 * text and never opened (mJournal only opens addresses it knows itself), and images are left out (showing them would
 * fetch them from the internet). What the release workflow adds for GitHub's Releases page, the VirusTotal links and
 * the "Full Changelog" link, is left out too, as it says nothing about what changes.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong' | 'em' | 'strike'; children: Inline[] };

export interface ListItem {
  content: Inline[];
  /** A list indented under this item, or null. */
  sublist: ListBlock | null;
}

export interface ListBlock {
  kind: 'list';
  ordered: boolean;
  /** The first number of an ordered list. */
  start: number;
  items: ListItem[];
}

export type Block =
  | { kind: 'heading'; level: number; content: Inline[] }
  | { kind: 'paragraph'; content: Inline[] }
  | { kind: 'quote'; content: Inline[] }
  | { kind: 'code'; text: string }
  | ListBlock;

/** Sections GitHub's Releases page has that aren't about what changes: they're left out with everything under them. */
const HIDDEN_SECTION = /^(virustotal|new contributors)\b/i;
/** Lines left out the same way: the link to the code that changed. */
const HIDDEN_LINE = /^full changelog\b/i;

// ---------------------------------------------------------------------------
// Inline text

/** The characters a backslash can escape. */
const PUNCTUATION = /[!-/:-@[-`{-~]/;
const SPACE = /\s/;
const WORD = /[\p{L}\p{N}]/u;

/** What can be left of HTML in text: tags go, a line break becomes a space. */
function withoutHtml(text: string): string {
  return text.replace(/<br\s*\/?>/gi, ' ').replace(/<\/?[a-z][\w-]*(?:\s[^<>]*)?\/?>/gi, '');
}

function pushText(out: Inline[], text: string): void {
  const last = out[out.length - 1];
  if (last?.kind === 'text') last.text += text;
  else if (text) out.push({ kind: 'text', text });
}

/** The end of a `[label](address)` that starts at `start` (the "["), and its label; null when it isn't one. */
function matchLink(text: string, start: number): { label: string; end: number } | null {
  let depth = 0;
  let close = -1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === '[') depth++;
    else if (text[i] === ']' && --depth === 0) {
      close = i;
      break;
    }
  }
  if (close === -1 || text[close + 1] !== '(') return null;
  depth = 0;
  for (let i = close + 1; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return { label: text.slice(start + 1, close), end: i + 1 };
  }
  return null;
}

/** Where the emphasis `delimiter` that opens at `start` closes, or -1. */
function closingDelimiter(text: string, start: number, delimiter: string): number {
  const char = delimiter[0];
  for (let i = start + delimiter.length + 1; i <= text.length - delimiter.length; i++) {
    if (text[i] === '\\') {
      i++;
      continue;
    }
    if (text.startsWith(delimiter, i) && !SPACE.test(text[i - 1]) && text[i - 1] !== char && text[i + delimiter.length] !== char) {
      // An underscore inside a word (snake_case) doesn't close.
      if (char === '_' && WORD.test(text[i + delimiter.length] ?? '')) continue;
      return i;
    }
  }
  return -1;
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let plain = '';
  const flush = () => {
    pushText(out, withoutHtml(plain));
    plain = '';
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\' && i + 1 < text.length && PUNCTUATION.test(text[i + 1])) {
      plain += text[i + 1];
      i += 2;
      continue;
    }
    if (c === '`') {
      const run = /^`+/.exec(text.slice(i))![0];
      const end = text.indexOf(run, i + run.length);
      if (end === -1) {
        plain += run;
        i += run.length;
        continue;
      }
      flush();
      const code = text.slice(i + run.length, end);
      out.push({ kind: 'code', text: code.trim() || code });
      i = end + run.length;
      continue;
    }
    if (c === '!' && text[i + 1] === '[') {
      const image = matchLink(text, i + 1);
      if (image) {
        i = image.end;
        continue;
      }
    }
    if (c === '[') {
      const link = matchLink(text, i);
      if (link) {
        flush();
        for (const part of parseInline(link.label)) {
          if (part.kind === 'text') pushText(out, part.text);
          else out.push(part);
        }
        i = link.end;
        continue;
      }
    }
    if (c === '<') {
      // An address in angle brackets is shown as it is.
      const address = /^<(https?:\/\/[^\s<>]+)>/.exec(text.slice(i));
      if (address) {
        plain += address[1];
        i += address[0].length;
        continue;
      }
    }
    if (c === '*' || c === '_' || (c === '~' && text[i + 1] === '~')) {
      const run = /^(\*+|_+|~+)/.exec(text.slice(i))![0];
      const delimiter = c === '~' ? '~~' : run.slice(0, Math.min(run.length, 3));
      const opens =
        !SPACE.test(text[i + delimiter.length] ?? ' ') && !(c === '_' && i > 0 && WORD.test(text[i - 1]));
      const end = opens && run.length === delimiter.length ? closingDelimiter(text, i, delimiter) : -1;
      if (end === -1) {
        plain += run;
        i += run.length;
        continue;
      }
      flush();
      const children = parseInline(text.slice(i + delimiter.length, end));
      if (c === '~') out.push({ kind: 'strike', children });
      else if (delimiter.length === 1) out.push({ kind: 'em', children });
      else if (delimiter.length === 2) out.push({ kind: 'strong', children });
      else out.push({ kind: 'strong', children: [{ kind: 'em', children }] });
      i = end + delimiter.length;
      continue;
    }
    plain += c;
    i++;
  }
  flush();
  return out;
}

/** The text without its formatting. */
export function plainText(content: Inline[]): string {
  return content.map((part) => ('children' in part ? plainText(part.children) : part.text)).join('');
}

// ---------------------------------------------------------------------------
// Blocks

interface RawItem {
  text: string;
  sublist: RawList | null;
}

interface RawList {
  kind: 'list';
  ordered: boolean;
  start: number;
  items: RawItem[];
}

type RawBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph' | 'quote'; text: string }
  | { kind: 'code'; text: string }
  | RawList;

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const LIST_ITEM = /^(\s*)(?:[-*+]|(\d{1,9})[.)])\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;

function indentOf(spaces: string): number {
  return spaces.replace(/\t/g, '    ').length;
}

function readBlocks(markdown: string): RawBlock[] {
  const lines = markdown
    .replace(/\r\n?/g, '\n')
    // HTML comments (GitHub's generated notes start with one), also one that never closes.
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .split('\n');
  const blocks: RawBlock[] = [];
  let text: { kind: 'paragraph' | 'quote'; text: string } | null = null;
  /** The open list and the lists nested in it, outermost first, with the indent of their items. */
  let lists: { indent: number; list: RawList }[] = [];
  let afterBlank = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      text = null;
      afterBlank = true;
      continue;
    }
    const blank = afterBlank;
    afterBlank = false;

    const fence = FENCE.exec(line);
    if (fence) {
      text = null;
      lists = [];
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) code.push(lines[i]);
      blocks.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      text = null;
      lists = [];
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] });
      continue;
    }
    if (RULE.test(line)) {
      text = null;
      lists = [];
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      text = null;
      const indent = indentOf(item[1]);
      while (lists.length > 1 && indent < lists[lists.length - 1].indent) lists.pop();
      const open = lists[lists.length - 1];
      const ordered = item[2] !== undefined;
      const entry: RawItem = { text: item[3].replace(/^\[[ xX]\]\s+/, ''), sublist: null };
      if (open && indent >= open.indent + 2) {
        // Indented under the item before it.
        const parent = open.list.items[open.list.items.length - 1];
        parent.sublist ??= { kind: 'list', ordered, start: Number(item[2] ?? 1), items: [] };
        parent.sublist.items.push(entry);
        lists.push({ indent, list: parent.sublist });
      } else if (open && open.list.ordered === ordered) {
        open.list.items.push(entry);
      } else {
        const list: RawList = { kind: 'list', ordered, start: Number(item[2] ?? 1), items: [entry] };
        blocks.push(list);
        lists = [{ indent, list }];
      }
      continue;
    }
    const quote = QUOTE.exec(line);
    if (quote) {
      lists = [];
      if (text?.kind === 'quote') text.text += ` ${quote[1]}`;
      else {
        text = { kind: 'quote', text: quote[1] };
        blocks.push(text);
      }
      continue;
    }
    const open = lists[lists.length - 1];
    // A line that goes on with the list item above it (indented when there's a blank line between).
    if (open && (!blank || indentOf(/^\s*/.exec(line)![0]) >= 2)) {
      const last = open.list.items[open.list.items.length - 1];
      last.text += ` ${line.trim()}`;
      continue;
    }
    lists = [];
    if (text) text.text += ` ${line.trim()}`;
    else {
      text = { kind: 'paragraph', text: line.trim() };
      blocks.push(text);
    }
  }
  return blocks;
}

function toList(raw: RawList): ListBlock | null {
  const items: ListItem[] = [];
  for (const item of raw.items) {
    const content = parseInline(item.text.trim());
    const sublist = item.sublist && toList(item.sublist);
    if (plainText(content).trim() || sublist) items.push({ content, sublist });
  }
  return items.length ? { kind: 'list', ordered: raw.ordered, start: raw.start, items } : null;
}

/** A release's notes as blocks to show, without what GitHub adds that isn't about the changes. */
export function parseReleaseNotes(markdown: string): Block[] {
  const blocks: Block[] = [];
  /** While leaving out a hidden section: the level of its heading. */
  let hiddenLevel: number | null = null;
  for (const raw of readBlocks(markdown)) {
    if (raw.kind === 'heading') {
      if (hiddenLevel !== null && raw.level > hiddenLevel) continue;
      const content = parseInline(raw.text);
      hiddenLevel = HIDDEN_SECTION.test(plainText(content).trim()) ? raw.level : null;
      if (hiddenLevel === null && plainText(content).trim()) blocks.push({ kind: 'heading', level: raw.level, content });
      continue;
    }
    if (hiddenLevel !== null) continue;
    if (raw.kind === 'code') {
      if (raw.text.trim()) blocks.push(raw);
    } else if (raw.kind === 'list') {
      const list = toList(raw);
      if (list) blocks.push(list);
    } else {
      const content = parseInline(raw.text.trim());
      const words = plainText(content).trim();
      if (words && !HIDDEN_LINE.test(words)) blocks.push({ kind: raw.kind, content });
    }
  }
  // A heading with nothing left under it goes too (from the end, so one that only held such headings goes as well).
  const shown: Block[] = [];
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    const next = shown[0];
    if (block.kind === 'heading' && (next === undefined || (next.kind === 'heading' && next.level <= block.level))) continue;
    shown.unshift(block);
  }
  return shown;
}
