import { expect, test } from '@playwright/test';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import {
  callApi,
  closeLikeUser,
  launch,
  localDateKey,
  makeDataDir,
  removeDir,
  stubOpenDialog,
  stubSaveDialog,
  writeImage,
  writeInternalSetting,
  type Launched,
} from './fixtures';

let run: Launched | null = null;
const dirs: string[] = [];

test.afterEach(async () => {
  if (run) {
    await run.app.close().catch(() => undefined);
    run = null;
  }
  for (const dir of dirs.splice(0)) removeDir(dir);
});

const saved = (page: Launched['page']) => expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved');

test('starts from a clean setup with the welcome guide, then today’s page', async () => {
  run = await launch(undefined, { guide: 'keep' });
  dirs.push(run.dataDir);
  const { page, dataDir, errors } = run;
  await expect(page).toHaveTitle('mJournal');
  const guide = page.getByRole('dialog', { name: 'Hello, and welcome to mJournal' });
  await expect(guide).toBeVisible();
  await guide.getByRole('button', { name: 'Skip guide' }).click();
  await expect(page.locator('dialog.guide')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('.eyebrow').first()).toHaveText('Today');
  await expect(page.getByRole('radiogroup', { name: 'Mood' })).toBeVisible();
  await expect(page.locator('.question-text')).not.toBeEmpty();
  expect(existsSync(join(dataDir, 'mjournal.db'))).toBe(true);
  expect(errors).toEqual([]);
});

test('writes today’s entry, saves it and finds it again after a restart', async () => {
  const dataDir = makeDataDir();
  dirs.push(dataDir);
  run = await launch(dataDir);
  let { page } = run;

  const question = await page.locator('.question-text').innerText();
  await page.locator('.question-card textarea').fill('A long call with Grandma.');
  await page.getByRole('radio', { name: 'Happy' }).click();
  await page.getByRole('radio', { name: /^4 of 5/ }).click();
  await page.getByRole('textbox', { name: 'Free writing' }).fill('Walked home the long way. The light was golden.');
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', /pending|saving|saved/);
  await saved(page);

  // Close the window like a user (the app flushes pending edits) and start again.
  await page.getByRole('textbox', { name: 'Free writing' }).fill('Walked home the long way. The light was golden. Tea after.');
  await closeLikeUser(run.app);
  run = await launch(dataDir);
  page = run.page;

  await expect(page.getByRole('textbox', { name: 'Free writing' })).toHaveValue('Walked home the long way. The light was golden. Tea after.');
  await expect(page.getByRole('radio', { name: 'Happy' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: /^4 of 5/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.question-text')).toHaveText(question);
  await expect(page.locator('.question-card textarea')).toHaveValue('A long call with Grandma.');
});

test('edits an earlier day and moves between days', async () => {
  run = await launch();
  dirs.push(run.dataDir);
  const { page } = run;
  await page.getByRole('link', { name: 'Previous day' }).click();
  await expect(page.locator('.eyebrow').first()).toHaveText('Yesterday');
  await page.getByRole('textbox', { name: 'Free writing' }).fill('Written a day late, and that is fine.');
  await saved(page);
  await page.getByRole('link', { name: 'Next day' }).click();
  await expect(page.locator('.eyebrow').first()).toHaveText('Today');
  await expect(page.getByRole('textbox', { name: 'Free writing' })).toHaveValue('');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.getByRole('textbox', { name: 'Free writing' })).toHaveValue('Written a day late, and that is fine.');
});

test('navigates the calendar and previews a day', async () => {
  run = await launch();
  dirs.push(run.dataDir);
  const { page } = run;
  const yesterday = localDateKey(-1);
  await callApi(page, 'entries', 'update', yesterday, { body: 'Calendar preview text', mood: 'calm' });

  await page.getByRole('link', { name: 'Calendar' }).click();
  const title = page.locator('.month-title h1');
  const thisMonth = await title.innerText();
  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(title).not.toHaveText(thisMonth);
  await page.getByRole('button', { name: 'Previous month' }).click();
  await page.getByRole('button', { name: 'Previous month' }).click();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(title).toHaveText(thisMonth);

  // Jump a year back with the month picker, then return.
  await title.click();
  await page.getByRole('button', { name: 'Previous year' }).click();
  await page.locator('.month-picker-item').first().click();
  await expect(title).toHaveText(/January \d{4}/);
  await page.getByRole('button', { name: 'Today', exact: true }).click();

  const cell = page.locator(`[data-date="${yesterday}"]`);
  await expect(cell).toHaveAttribute('aria-label', /mood: Calm/);
  await cell.click();
  await expect(page.locator('.day-preview')).toContainText('Calendar preview text');
  await page.getByRole('link', { name: /Open this day/ }).click();
  await expect(page.getByRole('textbox', { name: 'Free writing' })).toHaveValue('Calendar preview text');
});

test('adds photos with the same file name, makes thumbnails and shows them in Memories', async () => {
  run = await launch();
  dirs.push(run.dataDir);
  const { app, page } = run;
  const images = makeDataDir();
  dirs.push(images);
  const a = writeImage(join(images, 'phone'), 'IMG_0001.png', [240, 180, 190]);
  const b = writeImage(join(images, 'camera'), 'IMG_0001.png', [170, 200, 160]);
  await stubOpenDialog(app, [a, b]);

  await page.getByRole('button', { name: /Add photos/ }).click();
  await expect(page.locator('.day-photos .photo-tile')).toHaveCount(2);
  await expect
    .poll(async () => (await callApi<{ photos: { hasThumbnail: boolean }[] }>(page, 'entries', 'getDay', localDateKey())).photos.every((p) => p.hasThumbnail))
    .toBe(true);

  await page.locator('.day-photos .photo-tile').first().click();
  const caption = page.getByRole('textbox', { name: 'Caption' });
  await caption.fill('Strawberries at the market');
  await page.getByRole('button', { name: 'Close photo' }).click();
  await page.getByRole('link', { name: 'Memories' }).click();
  await expect(page.locator('.polaroid')).toHaveCount(2);
  await expect(page.locator('.polaroids')).toContainText('Strawberries at the market');
  expect(existsSync(a) && existsSync(b)).toBe(true);
});

test('reorders photos and moves one to another day from the photo viewer', async () => {
  run = await launch();
  dirs.push(run.dataDir);
  const { page } = run;
  const images = makeDataDir();
  dirs.push(images);
  await callApi(page, 'photos', 'importFiles', localDateKey(), [
    writeImage(images, 'first.png', [240, 180, 190]),
    writeImage(images, 'second.png', [170, 200, 160]),
  ]);
  await page.reload();
  await page.waitForSelector('.app');
  const names = async (date: string) =>
    (await callApi<{ photos: { originalName: string }[] }>(page, 'entries', 'getDay', date)).photos.map((p) => p.originalName);
  await expect(page.locator('.day-photos .photo-tile')).toHaveCount(2);

  await page.locator('.day-photos .photo-tile').first().click();
  await page.getByRole('button', { name: /Move later/ }).click();
  await expect.poll(() => names(localDateKey())).toEqual(['second.png', 'first.png']);
  // The viewer follows the photo to its new place.
  await expect(page.locator('dialog.lightbox .eyebrow').first()).toHaveText('2 of 2');

  await page.getByRole('button', { name: /Move to another day/ }).click();
  await page.getByLabel('Move this photo to').fill(localDateKey(-1));
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('Photo moved to');
  await expect(page.locator('.day-photos .photo-tile')).toHaveCount(1);
  expect(await names(localDateKey(-1))).toEqual(['first.png']);
  expect(await names(localDateKey())).toEqual(['second.png']);
});

test('makes the text larger with Ctrl + = and keeps it after a restart', async () => {
  const dataDir = makeDataDir();
  dirs.push(dataDir);
  run = await launch(dataDir);
  const zoom = (launched: Launched) =>
    launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor());
  await run.page.keyboard.press('Control+Equal');
  await expect.poll(() => zoom(run!)).toBeCloseTo(1.1);
  expect((await callApi<{ textSize: number }>(run.page, 'settings', 'get')).textSize).toBe(110);
  await closeLikeUser(run.app);

  run = await launch(dataDir);
  await expect.poll(() => zoom(run!)).toBeCloseTo(1.1);
  await run.page.getByRole('link', { name: 'Settings' }).click();
  await expect(run.page.getByRole('radio', { name: '110 %' })).toHaveAttribute('aria-checked', 'true');
  await run.page.keyboard.press('Control+0');
  await expect.poll(() => zoom(run!)).toBeCloseTo(1);
});

test('shows a gentle placeholder when a photo file is missing', async () => {
  run = await launch();
  dirs.push(run.dataDir);
  const { page } = run;
  const images = makeDataDir();
  dirs.push(images);
  const day = await callApi<{ imported: { id: string }[] }>(page, 'photos', 'importFiles', localDateKey(), [
    writeImage(images, 'gone.png', [200, 200, 240]),
  ]);
  const { rmSync, readdirSync } = await import('node:fs');
  const photosDir = join(run.dataDir, 'photos');
  for (const sub of readdirSync(photosDir)) rmSync(join(photosDir, sub), { recursive: true, force: true });
  expect(day.imported).toHaveLength(1);
  await page.reload();
  await expect(page.locator('.day-photos .photo-missing')).toBeVisible();
  await expect(page.locator('.day-photos .photo-missing')).toContainText('Photo unavailable');
});

test('searches and filters the journal', async () => {
  run = await launch();
  dirs.push(run.dataDir);
  const { page } = run;
  await callApi(page, 'entries', 'update', localDateKey(-3), { body: 'Baked banana bread with my brother', mood: 'happy' });
  await callApi(page, 'entries', 'update', localDateKey(-2), { body: 'Quiet rainy afternoon', mood: 'calm' });
  await callApi(page, 'entries', 'update', localDateKey(-1), { body: 'Another banana adventure', mood: 'tired', favorite: true });

  await page.getByRole('link', { name: 'Journal' }).click();
  await expect(page.locator('.result')).toHaveCount(3);
  await page.getByRole('searchbox', { name: 'Search your journal' }).fill('banana');
  await expect(page.locator('.result')).toHaveCount(2);
  await expect(page.locator('.result mark').first()).toHaveText(/banana/i);
  await page.getByRole('button', { name: /Favorites/ }).click();
  await expect(page.locator('.result')).toHaveCount(1);
  await expect(page.locator('.result')).toContainText('Another banana adventure');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.locator('.result')).toHaveCount(3);

  await page.getByRole('button', { name: /^Mood/ }).click();
  await page.getByRole('checkbox', { name: /Calm/ }).check();
  await expect(page.locator('.result')).toHaveCount(1);
  await expect(page.locator('.result')).toContainText('Quiet rainy afternoon');
});

test('keeps the monthly reflection across restarts', async () => {
  const dataDir = makeDataDir();
  dirs.push(dataDir);
  run = await launch(dataDir);
  let { page } = run;
  await page.getByRole('link', { name: 'Monthly' }).click();
  await expect(page.getByRole('heading', { name: 'What I recorded' })).toBeVisible();
  await page.getByRole('textbox', { name: /Letter to myself/ }).fill('Dear me, you did more than enough.');
  await page.locator('.reflection-q textarea').first().fill('Summer evenings with friends.');
  await saved(page);
  await closeLikeUser(run.app);

  run = await launch(dataDir);
  page = run.page;
  await page.getByRole('link', { name: 'Monthly' }).click();
  await expect(page.getByRole('textbox', { name: /Letter to myself/ })).toHaveValue('Dear me, you did more than enough.');
  await expect(page.locator('.reflection-q textarea').first()).toHaveValue('Summer evenings with friends.');
});

test('exports JSON and CSV', async () => {
  run = await launch();
  dirs.push(run.dataDir);
  const { app, page } = run;
  const out = makeDataDir();
  dirs.push(out);
  await callApi(page, 'entries', 'update', localDateKey(), { body: 'Exported thoughts', mood: 'calm', energy: 3 });
  await page.getByRole('link', { name: 'Settings' }).click();

  await stubSaveDialog(app, join(out, 'mJournal-export.json'));
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('exported as JSON');
  const json = JSON.parse(readFileSync(join(out, 'mJournal-export.json'), 'utf8'));
  expect(json.app).toBe('mJournal');
  expect(json.entries[0]).toMatchObject({ body: 'Exported thoughts', moodLabel: 'Calm', energy: 3 });

  await stubSaveDialog(app, join(out, 'mJournal-entries.csv'));
  await page.getByRole('button', { name: 'CSV', exact: true }).click();
  await expect(page.locator('.toast').last()).toContainText('exported as CSV');
  expect(readFileSync(join(out, 'mJournal-entries.csv'), 'utf8')).toContain('"Exported thoughts"');
});

test('creates a complete backup and restores it after confirmation', async () => {
  run = await launch();
  dirs.push(run.dataDir);
  const { app, page } = run;
  const out = makeDataDir();
  dirs.push(out);
  const backup = join(out, 'mJournal-backup-test.zip');
  await callApi(page, 'entries', 'update', localDateKey(), { body: 'The version worth keeping', mood: 'wonderful' });
  const images = makeDataDir();
  dirs.push(images);
  await callApi(page, 'photos', 'importFiles', localDateKey(), [writeImage(images, 'kept.png', [220, 190, 230])]);
  await page.reload();
  await page.waitForSelector('.app');
  const thumbnails = () => readdirSync(join(run!.dataDir, 'thumbnails')).length;
  await expect.poll(thumbnails).toBe(1);

  await page.getByRole('link', { name: 'Settings' }).click();
  await stubSaveDialog(app, backup);
  await page.getByRole('button', { name: /Create backup/ }).click();
  await expect(page.locator('.toast')).toContainText('Backup saved');
  expect(existsSync(backup)).toBe(true);

  await callApi(page, 'entries', 'update', localDateKey(), { body: 'An accidental overwrite' });
  await stubOpenDialog(app, [backup]);
  await page.getByRole('button', { name: /Restore…/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Restore this backup?' });
  await expect(dialog).toContainText('passed its checks');
  await expect(dialog).toContainText('replaces');
  const replace = dialog.getByRole('button', { name: 'Replace my journal' });
  await expect(replace).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await replace.click();
  await expect(page.getByRole('dialog', { name: 'Your journal has been restored' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForSelector('.app');
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(page.getByRole('textbox', { name: 'Free writing' })).toHaveValue('The version worth keeping');
  // The restore starts with an empty thumbnails folder; the photo's thumbnail is made again.
  await expect(page.locator('.day-photos .photo-tile')).toHaveCount(1);
  await expect.poll(thumbnails).toBe(1);
  await expect
    .poll(async () => (await callApi<{ photos: { hasThumbnail: boolean }[] }>(page, 'entries', 'getDay', localDateKey())).photos[0].hasThumbnail)
    .toBe(true);
});

test('refuses a corrupted backup and keeps the journal unchanged', async () => {
  run = await launch();
  dirs.push(run.dataDir);
  const { app, page } = run;
  const out = makeDataDir();
  dirs.push(out);
  const broken = join(out, 'broken.zip');
  writeFileSync(broken, 'definitely not a zip file');
  await callApi(page, 'entries', 'update', localDateKey(), { body: 'Still here' });

  await page.getByRole('link', { name: 'Settings' }).click();
  await stubOpenDialog(app, [broken]);
  await page.getByRole('button', { name: /Restore…/ }).click();
  await expect(page.locator('#settings-backup .notice.error')).toContainText(/isn.t an mJournal backup/);
  await expect(page.getByRole('dialog', { name: 'Restore this backup?' })).toBeHidden();
  const day = await callApi<{ entry: { body: string } }>(page, 'entries', 'getDay', localDateKey());
  expect(day.entry.body).toBe('Still here');
});

test('makes automatic backups into a folder the person chose', async () => {
  run = await launch();
  dirs.push(run.dataDir);
  const { app, page } = run;
  const folder = makeDataDir();
  dirs.push(folder);
  await callApi(page, 'entries', 'update', localDateKey(), { body: 'Backed up by itself' });
  await page.getByRole('link', { name: 'Settings' }).click();
  const section = page.locator('#settings-backup');
  // The switch follows the saved setting, so it flips once the setting is back from the main process.
  const autoBackup = section.getByRole('checkbox', { name: 'Automatic backups' });
  await autoBackup.click();
  await expect(autoBackup).toBeChecked();
  await stubOpenDialog(app, [folder]);
  await section.getByRole('button', { name: /Choose folder/ }).click();
  await expect(section).toContainText(folder);
  await section.getByRole('button', { name: /Back up now/ }).click();
  await expect.poll(() => readdirSync(folder).filter((n) => /^mJournal-auto-backup-.+\.zip$/.test(n)).length).toBe(1);
  await expect(section).toContainText('Last automatic backup');
  expect((await callApi<{ autoBackup: boolean }>(page, 'settings', 'get')).autoBackup).toBe(true);
});

test('protects backups with a password and restores them with it', async () => {
  run = await launch();
  dirs.push(run.dataDir);
  const { app, page, dataDir } = run;
  const out = makeDataDir();
  dirs.push(out);
  const backup = join(out, 'mJournal-backup-test.mjbackup');
  await callApi(page, 'entries', 'update', localDateKey(), { body: 'A private thought' });
  await page.getByRole('link', { name: 'Settings' }).click();

  await page.getByRole('button', { name: /Set a password/ }).click();
  const setDialog = page.getByRole('dialog', { name: 'Protect backups with a password' });
  await setDialog.getByLabel('Password', { exact: true }).fill('tea by the window');
  await setDialog.getByLabel('The same password again').fill('tea by the window');
  const protect = setDialog.getByRole('button', { name: 'Protect backups' });
  await expect(protect).toBeDisabled();
  await setDialog.getByRole('checkbox', { name: /saved this password/ }).check();
  await protect.click();
  await expect(page.locator('.toast')).toContainText('protected with your password');
  expect(existsSync(join(dataDir, 'backup-key.json'))).toBe(true);

  await stubSaveDialog(app, backup);
  await page.getByRole('button', { name: /Create backup/ }).click();
  await expect(page.locator('.toast').last()).toContainText('Backup saved');
  expect(readFileSync(backup).subarray(0, 8).toString('ascii')).toBe('MJBKENC1');
  expect(readFileSync(backup).includes(Buffer.from('A private thought'))).toBe(false);

  // On this computer the remembered key opens it without asking.
  await callApi(page, 'entries', 'update', localDateKey(), { body: 'Changed afterwards' });
  await stubOpenDialog(app, [backup]);
  await page.getByRole('button', { name: /Restore…/ }).click();
  const restoreDialog = page.getByRole('dialog', { name: 'Restore this backup?' });
  await expect(restoreDialog).toContainText('protected with a password');
  await restoreDialog.getByRole('checkbox').check();
  await restoreDialog.getByRole('button', { name: 'Replace my journal' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForSelector('.app');
  expect((await callApi<{ entry: { body: string } }>(page, 'entries', 'getDay', localDateKey())).entry.body).toBe('A private thought');

  // Without the remembered key (another computer), it asks for the password.
  const { rmSync } = await import('node:fs');
  rmSync(join(dataDir, 'backup-key.json'));
  await page.getByRole('link', { name: 'Settings' }).click();
  await stubOpenDialog(app, [backup]);
  await page.getByRole('button', { name: /Restore…/ }).click();
  const unlock = page.getByRole('dialog', { name: 'This backup has a password' });
  await unlock.getByLabel('Backup password').fill('coffee by the door');
  await unlock.getByRole('button', { name: 'Open backup' }).click();
  await expect(unlock).toContainText('doesn’t open this backup');
  await unlock.getByLabel('Backup password').fill('tea by the window');
  await unlock.getByRole('button', { name: 'Open backup' }).click();
  await expect(page.getByRole('dialog', { name: 'Restore this backup?' })).toContainText('passed its checks');
  await page.getByRole('dialog', { name: 'Restore this backup?' }).getByRole('button', { name: 'Cancel' }).click();
});

test('restores a daily safety snapshot from Settings', async () => {
  run = await launch();
  dirs.push(run.dataDir);
  const { page, dataDir } = run;
  await callApi(page, 'entries', 'update', localDateKey(), { body: 'Before the mistake' });
  const snapshots = join(dataDir, 'backups', 'automatic');
  // The first snapshot is taken a few seconds after mJournal starts.
  await expect
    .poll(() => existsSync(snapshots) && readdirSync(snapshots).some((n) => n.startsWith('mJournal-snapshot-')), { timeout: 20_000 })
    .toBe(true);
  await callApi(page, 'entries', 'update', localDateKey(), { body: 'After the mistake' });

  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /Restore a snapshot/ }).click();
  await page.getByRole('dialog', { name: 'Restore a snapshot' }).getByRole('button', { name: 'Choose' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Restore this snapshot?' });
  await expect(dialog).toContainText('photos stay as they are');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Replace my journal' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForSelector('.app');
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(page.getByRole('textbox', { name: 'Free writing' })).toHaveValue('Before the mistake');
});

test('tags a day with a chip or a #word, and finds it by tag', async () => {
  run = await launch();
  dirs.push(run.dataDir);
  const { page } = run;
  const picker = page.locator('.tag-picker');
  const walk = picker.getByRole('button', { name: 'Walk', exact: true });
  await walk.click();
  await expect(walk).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('textbox', { name: 'Free writing' }).fill('Picked strawberries with #Grandma');
  await saved(page);
  await expect(picker).toContainText('#Grandma');

  await page.getByRole('link', { name: 'Journal' }).click();
  await page.getByRole('button', { name: /^Tags/ }).click();
  await page.getByRole('checkbox', { name: /Grandma/ }).check();
  await expect(page.locator('.result')).toHaveCount(1);
  await expect(page.locator('.result')).toContainText('Walk');
});

test('deletes a day and brings it back with Undo or from Recently removed', async () => {
  run = await launch();
  dirs.push(run.dataDir);
  const { page } = run;
  const writing = page.getByRole('textbox', { name: 'Free writing' });
  const deleteDay = async () => {
    await page.locator('.day-footer').getByRole('button', { name: /Delete entry/ }).click();
    await page.getByRole('dialog', { name: /Delete this day/ }).getByRole('button', { name: 'Delete entry' }).click();
    await expect(writing).toHaveValue('');
  };
  await writing.fill('A day worth keeping');
  await saved(page);

  await deleteDay();
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(writing).toHaveValue('A day worth keeping');

  await deleteDay();
  await page.getByRole('link', { name: 'Settings' }).click();
  const removed = page.locator('#settings-removed');
  await expect(removed).toContainText('A day worth keeping');
  await removed.getByRole('button', { name: /Restore/ }).first().click();
  await expect(page.locator('.toast').last()).toContainText('is back');
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(writing).toHaveValue('A day worth keeping');
});

test('asks a pinned question every day and shows the month’s intention on Today', async () => {
  run = await launch();
  dirs.push(run.dataDir);
  const { page } = run;
  const pinned = await callApi<{ text: string }[]>(page, 'prompts', 'setPinned', 'joy-01', 127);
  await page.reload();
  await page.waitForSelector('.app');
  const card = page.locator('.answer-card.pinned');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText(pinned[0].text);
  await expect(card.getByRole('button', { name: 'Stop asking this every day' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('link', { name: 'Settings' }).click();
  const prompts = page.locator('#settings-prompts');
  await expect(prompts).toContainText(pinned[0].text);
  await prompts.getByRole('button', { name: 'Stop asking' }).click();
  await expect(prompts).toContainText('None yet');

  await page.getByRole('link', { name: 'Monthly' }).click();
  await page.getByRole('textbox', { name: /My intention for/ }).fill('Slow mornings');
  await saved(page);
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(page.locator('.answer-card.pinned')).toHaveCount(0);
  await expect(page.locator('.intention-line')).toContainText('Slow mornings');
});

test('writes a letter to a future day and keeps it sealed', async () => {
  run = await launch();
  dirs.push(run.dataDir);
  const { page } = run;
  await page.getByRole('button', { name: /Write to a future day/ }).click();
  const dialog = page.getByRole('dialog', { name: 'A letter to a future day' });
  await dialog.getByLabel('The day it opens').fill(localDateKey(30));
  await dialog.getByRole('button', { name: 'Write the letter' }).click();
  await page.getByRole('button', { name: /Write a letter to this day/ }).click();
  await page.getByRole('textbox', { name: /Letter to/ }).fill('Dear future me, I hope the garden grew.');
  await saved(page);
  const letters = await callApi<{ openOn: string; editable: boolean; body: string | null }[]>(page, 'capsules', 'list');
  expect(letters).toMatchObject([{ openOn: localDateKey(30), editable: true, body: 'Dear future me, I hope the garden grew.' }]);

  // Settings lists it by its dates only.
  await page.getByRole('link', { name: 'Settings' }).click();
  const section = page.locator('#settings-letters');
  await expect(section).toContainText('Opens');
  await expect(section).not.toContainText('garden');
});

test('opens a search result with its matches marked, and searches reflections too', async () => {
  run = await launch();
  dirs.push(run.dataDir);
  const { page } = run;
  await callApi(page, 'entries', 'update', localDateKey(-2), { body: 'A long walk by the sea, then tea.' });
  await callApi(page, 'entries', 'update', localDateKey(-1), { body: 'Walk to the shop in the rain.' });
  const month = localDateKey().slice(0, 7);
  await callApi(page, 'months', 'saveReflection', month, 'learned', 'The sea always calms me.');

  await page.getByRole('link', { name: 'Journal' }).click();
  const search = page.getByRole('searchbox', { name: 'Search your journal' });
  // The search follows the typing after a short pause; wait until the address has the new words.
  const searched = (text: string) =>
    expect.poll(() => page.evaluate(() => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('q'))).toBe(text);
  await search.fill('walk -rain');
  await searched('walk -rain');
  await expect(page.locator('.result-group:not(.writing-results) .result')).toHaveCount(1);
  await search.fill('"long walk"');
  await searched('"long walk"');
  await expect(page.locator('.result-group:not(.writing-results) .result')).toHaveCount(1);
  await page.locator('.result-group:not(.writing-results) .result').first().click();
  const banner = page.getByRole('region', { name: 'Search matches' });
  await expect(banner).toContainText('Matches for “"long walk"”');
  await expect(page.locator('.writing-card .writing-highlights mark')).toHaveText(['long walk']);
  await banner.getByRole('button', { name: 'Done' }).click();
  await expect(banner).toBeHidden();
  await expect(page.locator('.writing-highlights')).toHaveCount(0);

  await page.getByRole('link', { name: 'Journal' }).click();
  await search.fill('sea');
  await searched('sea');
  const writing = page.locator('.writing-results');
  await expect(writing).toContainText('Monthly reflection');
  await writing.locator('.result').click();
  await expect(page.getByRole('region', { name: 'Search matches' })).toContainText('Matches for');
  await expect(page.locator('.reflection .writing-highlights mark').first()).toHaveText('sea');
});

test('keeps a letter to the year in its year in review', async () => {
  const dataDir = makeDataDir();
  dirs.push(dataDir);
  run = await launch(dataDir);
  let { page } = run;
  await callApi(page, 'entries', 'update', localDateKey(), { body: 'Something to look back on', mood: 'happy' });
  await page.getByRole('link', { name: 'Monthly' }).click();
  await page.getByRole('link', { name: /Year in review/ }).click();
  const year = localDateKey().slice(0, 4);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(year);
  await expect(page.getByRole('heading', { name: 'What I recorded' })).toBeVisible();
  await expect(page.locator('.year-month')).toHaveCount(12);
  await page.getByRole('textbox', { name: `Letter to myself for ${year}` }).fill('Dear me, what a year.');
  await saved(page);
  await closeLikeUser(run.app);

  run = await launch(dataDir);
  page = run.page;
  await page.evaluate((hash) => (window.location.hash = hash), `#/year/${year}`);
  await expect(page.getByRole('textbox', { name: `Letter to myself for ${year}` })).toHaveValue('Dear me, what a year.');
});

test('shows gentle insights by weekday, energy, tags and month', async () => {
  run = await launch();
  dirs.push(run.dataDir);
  const { page } = run;
  await callApi(page, 'entries', 'update', localDateKey(-1), { mood: 'happy', energy: 4, body: 'A good day' });
  await callApi(page, 'entries', 'setTag', localDateKey(-1), 'Walk', true);
  await page.getByRole('link', { name: 'Insights' }).click();
  for (const name of ['Moods by weekday', 'Energy by mood', 'Tags', 'Words per month']) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  await expect(page.locator('section[aria-labelledby="energy-mood"]')).toContainText('Happy');
  await expect(page.locator('section[aria-labelledby="tag-counts"]')).toContainText('Walk');
  await page.getByRole('radio', { name: 'Photos' }).click();
  await expect(page.getByRole('heading', { name: 'Photos per month' })).toBeVisible();
});

test('adds a quick note to the end of today’s writing', async () => {
  run = await launch();
  dirs.push(run.dataDir);
  const { app, page } = run;
  await page.getByRole('textbox', { name: 'Free writing' }).fill('Morning pages.');
  // What the global shortcut and the tray's "Quick note…" do.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('mj-event:quick-note'));
  const dialog = page.getByRole('dialog', { name: /Quick note/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Quick note' }).fill('coffee with Ana');
  await dialog.getByRole('textbox', { name: 'Quick note' }).press('Control+Enter');
  await expect(dialog).toBeHidden();
  await expect(page.locator('.toast')).toContainText('Added to today');
  // The open page shows it right away, after what was being typed.
  await expect(page.getByRole('textbox', { name: 'Free writing' })).toHaveValue(/^Morning pages\.\n\n.+ — coffee with Ana$/);
});

test('keeps running in the tray when the window is closed, until it is quit', async () => {
  run = await launch();
  dirs.push(run.dataDir);
  const { app, page } = run;
  await callApi(page, 'settings', 'update', { keepInTray: true });
  await expect.poll(() => callApi<{ trayShown: boolean }>(page, 'app', 'desktopStatus').then((s) => s.trayShown)).toBe(true);
  await page.getByRole('textbox', { name: 'Free writing' }).fill('Still here after closing');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(false);
  // Hidden, not closed: everything typed was saved, and mJournal answers as before.
  expect((await callApi<{ entry: { body: string } }>(page, 'entries', 'getDay', localDateKey())).entry.body).toBe('Still here after closing');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
  await expect(page.getByRole('textbox', { name: 'Free writing' })).toHaveValue('Still here after closing');
  // Quitting really ends it.
  const exited = new Promise<void>((done) => app.process().once('exit', () => done()));
  await app.evaluate(({ app: electronApp }) => electronApp.quit());
  await exited;
  run = null;
});

test('a portable copy with its journal beside it offers no tray, sign-in or reminders', async () => {
  run = await launch(makeDataDir(), { portable: { app: true, dataBeside: true } });
  dirs.push(run.dataDir);
  const { page } = run;
  const info = await callApi<{ dataDir: string; portableApp: boolean; journalBesideApp: boolean; notificationsSupported: boolean }>(
    page,
    'app',
    'info',
  );
  expect(info).toMatchObject({ portableApp: true, journalBesideApp: true, notificationsSupported: false });
  expect(info.dataDir).toBe(join(run.dataDir, 'mJournal Data'));
  expect(existsSync(join(run.dataDir, 'mJournal Data', 'mjournal.db'))).toBe(true);
  // Even when asked for (say, in settings from an installed copy), the tray stays away.
  await callApi(page, 'settings', 'update', { keepInTray: true, openAtLogin: true });
  expect(await callApi(page, 'app', 'desktopStatus')).toMatchObject({ canOpenAtLogin: false, canKeepInTray: false, trayShown: false });

  await page.getByRole('link', { name: 'Settings' }).click();
  const background = page.locator('#settings-streaks');
  await expect(background.getByRole('heading', { name: 'Evening reminder' })).toBeVisible();
  await expect(background.getByRole('heading', { name: 'Keep mJournal in the tray' })).toHaveCount(0);
  await expect(background.getByRole('heading', { name: 'Open mJournal when I sign in' })).toHaveCount(0);
  await expect(background).toContainText('never left running when its drive is unplugged');
  await expect(background).toContainText('The portable mJournal can’t show reminders');
  await expect(background.getByRole('checkbox', { name: 'Evening reminder' })).toBeDisabled();
  await expect(page.locator('#settings-updates')).toContainText('can’t replace itself');
  await expect(page.locator('#settings-backup')).toContainText('only in the mJournal Data folder next to mJournal');
  await expect(page.locator('#settings-data')).toContainText('Anyone who has that drive could open them');
});

test('the portable app alone keeps the tray, but doesn’t open at sign-in', async () => {
  run = await launch(makeDataDir(), { portable: { app: true } });
  dirs.push(run.dataDir);
  const { page } = run;
  expect(await callApi(page, 'app', 'info')).toMatchObject({ portableApp: true, journalBesideApp: false, notificationsSupported: false });
  await page.getByRole('link', { name: 'Settings' }).click();
  const background = page.locator('#settings-streaks');
  await expect(background.getByRole('heading', { name: 'Keep mJournal in the tray' })).toBeVisible();
  await expect(background.getByRole('heading', { name: 'Open mJournal when I sign in' })).toHaveCount(0);
  await expect(background).toContainText('The portable mJournal doesn’t start with your computer');
  await expect(background.getByRole('checkbox', { name: 'Evening reminder' })).toBeDisabled();
  await expect(page.locator('#settings-backup')).toContainText('Your journal lives only on this computer');
  await background.getByRole('checkbox', { name: 'Keep mJournal in the tray' }).click();
  await expect.poll(() => callApi<{ trayShown: boolean }>(page, 'app', 'desktopStatus').then((s) => s.trayShown)).toBe(true);
});

test('keeps a drawing as a photo of the day', async () => {
  run = await launch();
  dirs.push(run.dataDir);
  const { page } = run;
  await page.getByRole('button', { name: /draw something/i }).click();
  const dialog = page.getByRole('dialog', { name: 'Draw something' });
  const keep = dialog.getByRole('button', { name: 'Keep it with this day' });
  await expect(keep).toBeDisabled();
  const canvas = dialog.getByRole('img', { name: /Drawing area/ });
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width * (0.2 + i * 0.05), box.y + box.height * (0.3 + i * 0.03));
  await page.mouse.up();
  await dialog.getByRole('radio', { name: 'Rose' }).click();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.7);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6);
  await page.mouse.up();
  await keep.click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.day-photos .photo-tile')).toHaveCount(1);
  const day = await callApi<{ photos: { originalName: string; mime: string }[] }>(page, 'entries', 'getDay', localDateKey());
  expect(day.photos[0].originalName).toMatch(/^doodle-\d{4}-\d{2}-\d{2}-\d{4}\.png$/);
  expect(day.photos[0].mime).toBe('image/png');
});

test('switches to the dark evening theme', async () => {
  run = await launch();
  dirs.push(run.dataDir);
  const { page } = run;
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe('rgb(31, 26, 35)');
  await page.getByRole('radio', { name: 'Light' }).click();
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe('rgb(251, 246, 239)');
});

test('welcomes a new person with a short guide (with animations on)', async () => {
  const dataDir = makeDataDir();
  dirs.push(dataDir);
  run = await launch(dataDir, { guide: 'keep', motion: 'no-preference' });
  let { page } = run;
  const guide = page.locator('dialog.guide');
  await expect(guide.getByRole('heading', { name: 'Hello, and welcome to mJournal' })).toBeVisible();
  await guide.getByRole('textbox', { name: 'What should mJournal call you?' }).fill('Robin');
  await guide.getByRole('button', { name: 'Let’s begin' }).click();
  await expect(guide.getByRole('heading', { name: 'A page for every day' })).toBeVisible();
  await guide.getByRole('button', { name: 'Next' }).click();
  await expect(guide.getByRole('heading', { name: 'Little moments, gathered' })).toBeVisible();
  await guide.getByRole('button', { name: 'Back' }).click();
  await expect(guide.getByRole('heading', { name: 'A page for every day' })).toBeVisible();
  await guide.getByRole('button', { name: 'Next' }).click();
  await guide.getByRole('button', { name: 'Next' }).click();
  await expect(guide.getByRole('heading', { name: 'Private by design' })).toBeVisible();
  await guide.getByRole('button', { name: 'Next' }).click();
  await expect(guide.getByRole('heading', { name: 'Make it yours' })).toBeVisible();
  await guide.getByRole('radio', { name: 'Dark' }).click();
  await guide.getByRole('radio', { name: 'Handwritten' }).click();
  await guide.getByRole('button', { name: 'Start writing' }).click();
  await expect(page.locator('dialog.guide')).toHaveCount(0);
  await expect(page.locator('.day-header .subtitle')).toContainText('Robin');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(31, 26, 35)');
  await expect(page.locator('html')).toHaveAttribute('data-writing', 'hand');

  // The guide doesn't come back on the next start.
  await closeLikeUser(run.app);
  run = await launch(dataDir, { guide: 'keep' });
  page = run.page;
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('dialog.guide')).toHaveCount(0);
});

test('keeps the guide’s buttons in reach in the smallest window', async () => {
  run = await launch(undefined, { guide: 'keep' });
  dirs.push(run.dataDir);
  const { app, page } = run;
  // The window's minimum size (see main/window.ts); reload so the guide lays out fresh at that size.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.unmaximize();
    win.setContentSize(640, 520);
  });
  await page.reload();
  const guide = page.locator('dialog.guide');
  for (const name of ['Let’s begin', 'Next', 'Next', 'Next', 'Start writing']) {
    const button = guide.getByRole('button', { name, exact: true });
    await expect(button).toBeInViewport({ ratio: 1 });
    await button.click();
  }
  await expect(guide).toHaveCount(0);
});

test('shows one-time tips that stay dismissed, and can bring them back', async () => {
  const dataDir = makeDataDir();
  dirs.push(dataDir);
  run = await launch(dataDir);
  let { page } = run;
  await page.getByRole('link', { name: 'Calendar' }).click();
  const tip = page.getByRole('complementary', { name: 'Tip' });
  await expect(tip).toContainText('Page Up / Page Down');
  await tip.getByRole('button', { name: 'Got it' }).click();
  await expect(page.getByRole('complementary', { name: 'Tip' })).toHaveCount(0);

  await closeLikeUser(run.app);
  run = await launch(dataDir);
  page = run.page;
  await page.getByRole('link', { name: 'Calendar' }).click();
  await expect(page.locator('.month-title h1')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Tip' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Show tips again' }).click();
  // Not just "calendar": Settings also has a "Dates & calendar" link. (In a narrow window the
  // sidebar shows icons only and the link is named by its tooltip, "Calendar (Ctrl+2)".)
  await page.getByRole('link', { name: /^Calendar/ }).click();
  await expect(page.getByRole('complementary', { name: 'Tip' })).toContainText('Page Up / Page Down');
});

test('mentions a new version from GitHub, links to it and can put the note away', async () => {
  // Stands in for GitHub's "latest release" answer, so the test never goes online.
  const requests: string[] = [];
  const github = createServer((request, response) => {
    requests.push(request.headers['user-agent'] ?? '');
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ tag_name: 'v9.9.9', draft: false, prerelease: false }));
  });
  await new Promise<void>((resolve) => github.listen(0, '127.0.0.1', resolve));
  const env = { MJOURNAL_UPDATE_URL: `http://127.0.0.1:${(github.address() as AddressInfo).port}/latest` };
  try {
    const dataDir = makeDataDir();
    dirs.push(dataDir);
    run = await launch(dataDir, { env });
    let { app, page } = run;
    await app.evaluate(({ shell }) => {
      const opened: string[] = [];
      (globalThis as { opened?: string[] }).opened = opened;
      shell.openExternal = (async (url: string) => void opened.push(url)) as typeof shell.openExternal;
    });

    const note = page.getByRole('status', { name: 'New version' });
    await expect(note).toContainText('mJournal 9.9.9 is out');
    await note.getByRole('button', { name: 'Get it' }).click();
    await expect
      .poll(() => app.evaluate(() => (globalThis as { opened?: string[] }).opened))
      .toEqual(['https://github.com/LucaBarbaLata/mJournal/releases/latest']);
    await note.getByRole('button', { name: 'Not now' }).click();
    await expect(note).toHaveCount(0);
    expect(requests).toEqual(['mJournal']);

    // After a restart: it asks again (every start does), the note stays away, and Settings still knows.
    await closeLikeUser(app);
    run = await launch(dataDir, { env });
    ({ app, page } = run);
    await expect.poll(() => requests.length).toBe(2);
    await page.getByRole('link', { name: /^Settings/ }).click();
    await expect(page.locator('#settings-updates')).toContainText('mJournal 9.9.9 is out. You have');
    await expect(page.getByRole('status', { name: 'New version' })).toHaveCount(0);
  } finally {
    github.close();
  }
});

test('says once, after an update, whether it worked', async () => {
  const dataDir = makeDataDir();
  dirs.push(dataDir);
  run = await launch(dataDir);
  let { app, page } = run;
  const version = await app.evaluate(({ app: electronApp }) => electronApp.getVersion());
  await closeLikeUser(app);

  // mJournal closed to install this version, and opened again in it.
  writeInternalSetting(dataDir, 'pendingUpdate', { version, previous: '1.0.0' });
  run = await launch(dataDir);
  ({ app, page } = run);
  const worked = page.getByRole('dialog', { name: 'The update worked' });
  await expect(worked).toContainText(`mJournal was updated from 1.0.0 to ${version}.`);
  await worked.getByRole('button', { name: 'OK' }).click();
  await expect(worked).toHaveCount(0);
  await closeLikeUser(app);

  // Seen once is enough.
  run = await launch(dataDir);
  ({ app, page } = run);
  expect((await callApi<{ result: unknown }>(page, 'updates', 'status')).result).toBeNull();
  await expect(page.getByRole('dialog', { name: 'The update worked' })).toHaveCount(0);
  await closeLikeUser(app);

  // mJournal closed to install a newer version, but opened again in the old one.
  writeInternalSetting(dataDir, 'pendingUpdate', { version: '99.0.0', previous: version });
  run = await launch(dataDir);
  ({ app, page } = run);
  const failed = page.getByRole('dialog', { name: 'The update didn’t work' });
  await expect(failed).toContainText('mJournal 99.0.0 wasn’t installed.');
  await expect(failed).toContainText(`You still have mJournal ${version}`);
  // This copy can't install updates itself (a development build), so only GitHub is offered.
  await expect(failed.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await expect(failed.getByRole('button', { name: 'Get it from GitHub' })).toBeVisible();
  await failed.getByRole('button', { name: 'Not now' }).click();
  await expect(failed).toHaveCount(0);
  expect((await callApi<{ result: unknown }>(page, 'updates', 'status')).result).toBeNull();
});

test('can be used with the keyboard alone', async () => {
  run = await launch();
  dirs.push(run.dataDir);
  const { page } = run;
  await page.keyboard.press('Control+2');
  await expect(page.locator('.month-title h1')).toBeVisible();
  await page.keyboard.press('Control+1');
  const mood = page.getByRole('radio', { name: 'Wonderful' });
  await mood.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Happy' })).toBeFocused();
  await expect(page.getByRole('radio', { name: 'Happy' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Control+f');
  await expect(page.getByRole('searchbox', { name: 'Search your journal' })).toBeFocused();
});

test('keeps the journal behind a PIN, from Settings to the next start', async () => {
  const dataDir = makeDataDir();
  dirs.push(dataDir);
  run = await launch(dataDir);
  let { page } = run;
  const today = localDateKey();
  await callApi(page, 'entries', 'update', today, { body: 'A secret about the garden.' });
  const images = makeDataDir();
  dirs.push(images);
  const photo = writeImage(images, 'garden.png', [120, 180, 90]);
  const imported = await callApi<{ imported: { id: string }[] }>(page, 'photos', 'importFiles', today, [photo]);
  const photoId = imported.imported[0].id;
  const photoStatus = () => page.evaluate(async (id) => (await fetch(`mj-media://photo/${id}`)).status, photoId);
  expect(await photoStatus()).toBe(200);

  await page.keyboard.press('Control+,');
  await page.locator('#settings-pin').getByRole('button', { name: 'Set a PIN…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Set a PIN' });
  await dialog.getByLabel('New PIN', { exact: true }).fill('2468');
  await dialog.getByLabel('New PIN again').fill('2486');
  await dialog.getByRole('button', { name: 'Set PIN' }).click();
  await expect(dialog.getByRole('alert')).toContainText('aren’t the same');
  await dialog.getByLabel('New PIN again').fill('2468');
  await dialog.getByRole('button', { name: 'Set PIN' }).click();
  await expect(page.locator('#settings-pin').getByRole('button', { name: 'Change PIN…' })).toBeVisible();
  const lockFile = join(dataDir, 'lock.json');
  expect(existsSync(lockFile)).toBe(true);
  expect(readFileSync(lockFile, 'utf8')).not.toContain('2468');

  // The next start asks for the PIN, and nothing of the journal can be reached until then.
  await closeLikeUser(run.app);
  run = await launch(dataDir, { locked: true });
  page = run.page;
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.locator('.app')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('garden');
  const refused = await page.evaluate(async (date) => window.mjournalIpc!.entries.getDay(date), today);
  expect(refused).toMatchObject({ ok: false, code: 'locked' });
  expect(await photoStatus()).toBe(404);

  const pin = page.getByLabel('PIN', { exact: true });
  await pin.fill('1357');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.locator('#lock-message')).toContainText('not the right PIN');
  await expect(pin).toHaveValue('');
  await expect(pin).toBeFocused();
  await pin.fill('2468');
  await pin.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Free writing' })).toHaveValue('A secret about the garden.');
  expect(await photoStatus()).toBe(200);
});

test('locks with Ctrl+L and after a while without use, saving first, and the PIN can be turned off', async () => {
  run = await launch();
  dirs.push(run.dataDir);
  const { page } = run;
  // Set behind the interface's back: the main process tells the window, and the Lock button appears.
  await callApi(page, 'lock', 'setPin', null, '1234');
  await expect(page.locator('.sidebar').getByRole('button', { name: 'Lock' })).toBeVisible();

  // Words typed just before locking are saved, not lost.
  await page.getByRole('textbox', { name: 'Free writing' }).fill('Typed right before locking.');
  await page.keyboard.press('Control+l');
  await expect(page.locator('.lock-screen')).toBeVisible();
  await page.getByLabel('PIN', { exact: true }).fill('1234');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Free writing' })).toHaveValue('Typed right before locking.');

  // After a minute without input it locks by itself.
  await page.clock.install();
  await page.keyboard.press('Control+,');
  const autoLock = page.locator('#settings-pin select');
  await autoLock.selectOption('1');
  await expect(autoLock).toHaveValue('1');
  await page.clock.fastForward('01:10');
  await expect(page.locator('.lock-screen')).toBeVisible();

  await page.getByLabel('PIN', { exact: true }).fill('1234');
  await page.keyboard.press('Enter');
  const section = page.locator('#settings-pin');
  await section.getByRole('button', { name: 'Turn off PIN…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Turn off the PIN' });
  await dialog.getByLabel('Current PIN').fill('0000');
  await dialog.getByRole('button', { name: 'Turn off' }).click();
  await expect(dialog.getByRole('alert')).toContainText('not your current PIN');
  await dialog.getByLabel('Current PIN').fill('1234');
  await dialog.getByRole('button', { name: 'Turn off' }).click();
  await expect(section.getByRole('button', { name: 'Set a PIN…' })).toBeVisible();
  await expect(page.locator('.sidebar').getByRole('button', { name: 'Lock' })).toHaveCount(0);
  expect(existsSync(join(run.dataDir, 'lock.json'))).toBe(false);
});
