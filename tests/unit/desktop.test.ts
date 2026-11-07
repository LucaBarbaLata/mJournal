import { describe, expect, it } from 'vitest';
import { desktopEntry, desktopExecArg } from '../../src/main/desktopEntry';
import { openJournal } from './helpers';

describe('opening at sign-in on Linux', () => {
  it('quotes the program path as the desktop entry specification asks', () => {
    expect(desktopExecArg('/opt/mJournal/mjournal')).toBe('"/opt/mJournal/mjournal"');
    expect(desktopExecArg('/home/mia/Apps/mJournal 1.2.AppImage')).toBe('"/home/mia/Apps/mJournal 1.2.AppImage"');
    // ", `, $ and \ are escaped, then every backslash is doubled; % becomes %%.
    expect(desktopExecArg('/a"b`c$d\\e%f')).toBe('"/a\\\\"b\\\\`c\\\\$d\\\\\\\\e%%f"');
  });

  it('starts mJournal hidden, from the right file', () => {
    const entry = desktopEntry('/home/mia/mJournal.AppImage');
    expect(entry.split('\n')).toContain('Exec="/home/mia/mJournal.AppImage" --hidden');
    expect(entry.startsWith('[Desktop Entry]\nType=Application\nName=mJournal\n')).toBe(true);
    expect(entry).toContain('X-GNOME-Autostart-enabled=true');
  });
});

describe('quick notes', () => {
  it('are added to the end of the day’s writing after a blank line', () => {
    const j = openJournal();
    expect(j.entries.appendToBody('2026-10-24', '09:05 — first coffee').body).toBe('09:05 — first coffee');
    j.entries.update('2026-10-24', { body: '09:05 — first coffee\n\nA longer thought.\n\n\n' });
    expect(j.entries.appendToBody('2026-10-24', '14:30 — walk #outside').body).toBe(
      '09:05 — first coffee\n\nA longer thought.\n\n14:30 — walk #outside',
    );
    // Like any other writing: counted, searchable, its #tags picked up.
    expect(j.entries.tags('2026-10-24').map((t) => t.name)).toEqual(['outside']);
    expect(j.search.search({ text: 'coffee' }).results).toHaveLength(1);
  });
});
