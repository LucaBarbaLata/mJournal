import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_METHODS } from '@core/api';
import type { Settings } from '@core/api';
import type { UpdateStatus } from '@core/updates';
import { createApi, parseSearchQuery, type Platform } from '../../src/main/api';
import { AppLock } from '../../src/main/lock';
import { PNG_1PX, fakeClock, openHost, tempDir } from './helpers';

function setup(overrides: Partial<Platform> = {}) {
  const dir = tempDir();
  const host = openHost(dir, fakeClock('2026-10-24T18:00:00Z'), 'US');
  const revealed: string[] = [];
  const changed: Settings[] = [];
  const opened: string[] = [];
  const upToDate: UpdateStatus = {
    state: 'up-to-date',
    current: '1.0.0',
    latest: null,
    checkedAt: '2026-10-24T18:00:00.000Z',
    installer: null,
    progress: null,
    installError: null,
    result: null,
  };
  const platform: Platform = {
    appVersion: '1.0.0-test',
    platformName: 'test',
    notificationsSupported: false,
    chooseImages: async () => [],
    chooseBackupFile: async () => null,
    chooseFolder: async () => null,
    desktopStatus: () => ({ canOpenAtLogin: false, canKeepInTray: true, trayShown: false, shortcut: null }),
    portableApp: false,
    journalBesideApp: false,
    chooseSaveLocation: async () => null,
    showItemInFolder: (p) => revealed.push(p),
    openFolder: async () => undefined,
    settingsChanged: (s) => changed.push(s),
    updates: {
      status: () => upToDate,
      check: async () => upToDate,
      install: async () => upToDate,
      dismissResult: () => upToDate,
      changes: async () => ({ releases: [{ version: '1.1.0', publishedAt: null, notes: 'New' }], complete: true }),
    },
    openReleasePage: async () => void opened.push('releases'),
    ...overrides,
  };
  const appLock = AppLock.load(join(dir, 'lock.json'));
  return { api: createApi(host, platform, appLock), appLock, host, dir, revealed, changed, opened };
}

describe('API handlers', () => {
  it('implement every method in the contract', () => {
    const { api } = setup();
    for (const [ns, methods] of Object.entries(API_METHODS)) {
      for (const method of methods) {
        expect(typeof (api as unknown as Record<string, Record<string, unknown>>)[ns][method]).toBe('function');
      }
    }
  });

  it('validate every argument coming from the interface', async () => {
    const { api } = setup();
    await expect(api.entries.getDay('2026-02-30')).rejects.toThrow(/Invalid date/);
    await expect(api.entries.getDay('../../etc')).rejects.toThrow();
    await expect(api.entries.update('2026-10-24', { body: 42 })).rejects.toThrow(/Invalid entry/);
    await expect(api.entries.update('2026-10-24', { energy: 6 })).rejects.toThrow(/energy/);
    await expect(api.entries.update('2026-10-24', { body: 'x'.repeat(200_001) })).rejects.toThrow(/too long/);
    await expect(api.entries.update('2026-10-24', 'nope')).rejects.toThrow();
    await expect(api.entries.saveAnswer('2026-10-24', { promptId: 'Robert); DROP', promptText: 'Q', answer: 'A' })).rejects.toThrow(/prompt/);
    await expect(api.photos.update('../x', {})).rejects.toThrow(/photo/);
    await expect(api.settings.update({ theme: 'neon' })).rejects.toThrow();
    await expect(api.stats.overview('2026-10-24', 'decade')).rejects.toThrow(/range/);
    await expect(api.months.saveReflection('2026-10', 'not-a-question', 'x')).rejects.toThrow();
    await expect(api.data.restoreBackup('not-a-token')).rejects.toThrow(/restore request/);
    await expect(api.settings.update({ textSize: 175 })).rejects.toThrow();
    await expect(api.photos.gallery({ limit: 0 })).rejects.toThrow(/limit/);
    await expect(api.photos.gallery({ limit: 1.5 })).rejects.toThrow(/limit/);
    await expect(api.photos.moveToDay('../x', '2026-10-20')).rejects.toThrow(/photo/);
    await expect(api.stats.streak('today')).rejects.toThrow(/date/);
    await expect(api.tags.create('a/b')).rejects.toThrow(/letters, numbers/);
    await expect(api.tags.create('')).rejects.toThrow(/tag/);
    await expect(api.entries.setTag('2026-10-30', 'Walk', true)).rejects.toThrow(/hasn't happened yet/);
    await expect(api.entries.setTag('2026-10-24', 'Walk', 'yes')).rejects.toThrow();
    await expect(api.entries.restoreRemoved(0)).rejects.toThrow(/removed day/);
    await expect(api.prompts.setPinned('joy-01', 128)).rejects.toThrow(/weekdays/);
    await expect(api.capsules.create('next year')).rejects.toThrow(/day/);
    await expect(api.capsules.save(1.5, 'x')).rejects.toThrow(/letter/);
    await expect(api.months.saveReflection('2026-10', 'intention', 'x'.repeat(301))).rejects.toThrow(/too long/);
    await expect(api.journal.search({ tags: [42] })).rejects.toThrow(/tag/);
    await expect(api.settings.update({ quickNoteShortcut: 'Alt+F4' })).rejects.toThrow();
    await expect(api.settings.update({ keepInTray: 'yes' })).rejects.toThrow();
    await expect(api.entries.appendToBody('2026-10-30', 'from the future')).rejects.toThrow(/hasn't happened yet/);
    await expect(api.entries.appendToBody('2026-10-24', '   ')).rejects.toThrow(/Please enter a note/);
    await expect(api.years.recap(99)).rejects.toThrow(/year/);
    await expect(api.years.saveReflection(2026, 'nope', 'x')).rejects.toThrow(/question/);
    await expect(api.trackers.create({ label: 'Sleep', kind: 'stars' })).rejects.toThrow(/kind of tracker/);
    await expect(api.trackers.create({ label: '', kind: 'check' })).rejects.toThrow(/name for the tracker/);
    await expect(api.trackers.update(0, { label: 'x' })).rejects.toThrow(/tracker/);
    await expect(api.trackers.reorder(['1'])).rejects.toThrow(/tracker/);
    await expect(api.trackers.setForDay('2026-10-30', 1, 1)).rejects.toThrow(/hasn't happened yet/);
    await expect(api.trackers.setForDay('2026-10-24', 1, 6)).rejects.toThrow(/answer/);
    await expect(api.trackers.setForDay('2026-10-24', 1, '1')).rejects.toThrow(/answer/);
  });

  it('answers trackers and returns them with the day', async () => {
    const { api } = setup();
    const outside = await api.trackers.create({ label: 'Went outside', kind: 'check' });
    expect(await api.trackers.setForDay('2026-10-24', outside.id, 1)).toEqual([{ trackerId: outside.id, value: 1 }]);
    expect((await api.entries.getDay('2026-10-24')).trackers).toEqual([{ trackerId: outside.id, value: 1 }]);
    expect(await api.trackers.setForDay('2026-10-24', outside.id, null)).toEqual([]);
  });

  it('turns on the tray, opening at sign-in and the quick-note shortcut', async () => {
    const { api, changed } = setup();
    const next = await api.settings.update({ keepInTray: true, openAtLogin: true, quickNoteShortcut: 'CommandOrControl+Alt+J' });
    expect(next).toMatchObject({ keepInTray: true, openAtLogin: true, quickNoteShortcut: 'CommandOrControl+Alt+J' });
    expect(changed.at(-1)?.quickNoteShortcut).toBe('CommandOrControl+Alt+J');
    expect(await api.app.desktopStatus()).toEqual({ canOpenAtLogin: false, canKeepInTray: true, trayShown: false, shortcut: null });
    expect(await api.app.info()).toMatchObject({ portableApp: false, journalBesideApp: false });
  });

  it('keeps a deleted day in Recently removed and can bring it back', async () => {
    const { api } = setup();
    await api.entries.update('2026-10-24', { body: 'Worth keeping', mood: 'calm' });
    await api.entries.setTag('2026-10-24', 'Walk', true);
    const { removedId } = await api.entries.remove('2026-10-24');
    expect(removedId).not.toBeNull();
    expect((await api.entries.getDay('2026-10-24')).entry).toBeNull();
    expect(await api.entries.restoreRemoved(removedId!)).toBe('2026-10-24');
    const day = await api.entries.getDay('2026-10-24');
    expect(day.entry?.body).toBe('Worth keeping');
    expect(day.tags.map((t) => t.label)).toEqual(['Walk']);
    expect(await api.entries.remove('2026-10-01')).toEqual({ removedId: null });
  });

  it('rejects writing to days that haven’t happened yet', async () => {
    const { api } = setup();
    await expect(api.entries.update('2026-10-25', { body: 'tomorrow is allowed (time zones)' })).resolves.toBeDefined();
    await expect(api.entries.update('2026-10-30', { body: 'future' })).rejects.toThrow(/hasn't happened yet/);
  });

  it('strips control characters from stored text', async () => {
    const { api } = setup();
    const entry = await api.entries.update('2026-10-24', { body: 'a\u0000b\u0001c' });
    expect(entry.body).toBe('abc');
  });

  it('parses search queries strictly', () => {
    expect(parseSearchQuery({ text: 'hi', moods: ['calm'], order: 'oldest', limit: 10 })).toMatchObject({ text: 'hi', moods: ['calm'], order: 'oldest', limit: 10, cursor: null });
    expect(() => parseSearchQuery({ limit: 5000 })).toThrow();
    expect(() => parseSearchQuery({ from: 'yesterday' })).toThrow();
    expect(() => parseSearchQuery({ moods: ['a b'] })).toThrow();
  });

  it('imports photos picked in the file dialog', async () => {
    const source = join(tempDir(), 'pick.png');
    writeFileSync(source, PNG_1PX);
    const { api } = setup({ chooseImages: async () => [source] });
    const result = await api.photos.pickAndImport('2026-10-24');
    expect(result.imported).toHaveLength(1);
    expect(result.imported[0].originalName).toBe('pick.png');
  });

  it('adds a large selection in batches, up to what a day can hold', async () => {
    const dir = tempDir();
    const sources = Array.from({ length: 65 }, (_, i) => {
      const file = join(dir, `pick-${i}.png`);
      writeFileSync(file, PNG_1PX);
      return file;
    });
    const { api } = setup({ chooseImages: async () => sources });
    const result = await api.photos.pickAndImport('2026-10-24');
    expect(result.imported).toHaveLength(60);
    expect(result.rejected).toHaveLength(5);
    expect(result.rejected[0].reason).toMatch(/up to 60 photos/);
  });

  it('moves photos only to days that can be written to', async () => {
    const { api } = setup();
    const { imported } = await api.photos.importData('2026-10-24', [{ name: 'a.png', data: PNG_1PX }]);
    await expect(api.photos.moveToDay(imported[0].id, '2026-10-30')).rejects.toThrow(/hasn't happened yet/);
    expect((await api.photos.moveToDay(imported[0].id, '2026-10-01')).date).toBe('2026-10-01');
  });

  it('gives Today the streak without the whole overview', async () => {
    const { api } = setup();
    await api.entries.update('2026-10-23', { mood: 'calm' });
    await api.entries.update('2026-10-24', { mood: 'happy' });
    const streak = await api.stats.streak('2026-10-24');
    expect(streak).toEqual((await api.stats.overview('2026-10-24', 'month')).streak);
    expect(streak.current).toBe(2);
  });

  it('exports JSON and CSV to the chosen location and reveals only those files', async () => {
    const out = tempDir();
    let n = 0;
    const { api, revealed } = setup({ chooseSaveLocation: async (name) => join(out, `${n++}-${name}`) });
    await api.entries.update('2026-10-24', { body: 'Exported words', mood: 'calm' });
    const json = await api.data.exportJson();
    const csv = await api.data.exportCsv();
    expect(json.path).toMatch(/0-mJournal-export-2026-10-24-\d{4}\.json$/);
    expect(csv.path).toMatch(/1-mJournal-entries-2026-10-24-\d{4}\.csv$/);
    expect(JSON.parse(readFileSync(json.path!, 'utf8')).entries[0].body).toBe('Exported words');
    expect(readFileSync(csv.path!, 'utf8')).toContain('Exported words');

    await api.data.showSavedFile(json.path!);
    await api.data.showSavedFile('C:\\Windows\\System32\\drivers\\etc\\hosts');
    expect(revealed).toEqual([json.path]);
  });

  it('does nothing when a save dialog is cancelled', async () => {
    const { api } = setup();
    expect(await api.data.exportJson()).toEqual({ canceled: true });
    expect(await api.data.createBackup()).toEqual({ canceled: true });
    expect(await api.data.inspectBackup()).toBeNull();
  });

  it('applies settings and tells the platform (for theme and reminders)', async () => {
    const { api, changed } = setup();
    expect((await api.settings.get()).dateFormat).toBe('month-first');
    const next = await api.settings.update({ theme: 'dark' });
    expect(next.theme).toBe('dark');
    expect(changed.at(-1)?.theme).toBe('dark');
    expect(next.textSize).toBe(100);
    expect((await api.settings.update({ textSize: 125 })).textSize).toBe(125);
    expect(changed.at(-1)?.textSize).toBe(125);
  });

  it('describes the data folder honestly', async () => {
    const { api, dir } = setup();
    const info = await api.data.info();
    expect(info.dataDir).toBe(dir);
    expect(info.encryptedAtRest).toBe(false);
    expect(existsSync(info.databasePath)).toBe(true);
  });

  it('passes update checks and installs to the platform, and opens only the releases page', async () => {
    const { api, opened } = setup();
    expect((await api.updates.status()).state).toBe('up-to-date');
    expect((await api.updates.check()).state).toBe('up-to-date');
    expect((await api.updates.install()).state).toBe('up-to-date');
    expect((await api.updates.dismissResult()).result).toBeNull();
    expect((await api.updates.changes()).releases.map((release) => release.version)).toEqual(['1.1.0']);
    await api.updates.openReleasePage();
    expect(opened).toEqual(['releases']);
  });
});
