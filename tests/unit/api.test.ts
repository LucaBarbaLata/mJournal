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
  const upToDate: UpdateStatus = { state: 'up-to-date', current: '1.0.0', latest: null, checkedAt: '2026-10-24T18:00:00.000Z' };
  const platform: Platform = {
    appVersion: '1.0.0-test',
    platformName: 'test',
    notificationsSupported: false,
    chooseImages: async () => [],
    chooseBackupFile: async () => null,
    chooseSaveLocation: async () => null,
    showItemInFolder: (p) => revealed.push(p),
    openFolder: async () => undefined,
    settingsChanged: (s) => changed.push(s),
    updates: { status: () => upToDate, check: async () => upToDate },
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
  });

  it('describes the data folder honestly', async () => {
    const { api, dir } = setup();
    const info = await api.data.info();
    expect(info.dataDir).toBe(dir);
    expect(info.encryptedAtRest).toBe(false);
    expect(existsSync(info.databasePath)).toBe(true);
  });

  it('passes update checks to the platform, which only ever opens the releases page', async () => {
    const { api, opened } = setup();
    expect((await api.updates.status()).state).toBe('up-to-date');
    expect((await api.updates.check()).state).toBe('up-to-date');
    await api.updates.openReleasePage();
    expect(opened).toEqual(['releases']);
  });
});
