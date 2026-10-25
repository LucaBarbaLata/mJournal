import { expect, test } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

    // After a restart: no new request so soon, the note stays away, and Settings still knows.
    await closeLikeUser(app);
    run = await launch(dataDir, { env });
    ({ app, page } = run);
    await page.getByRole('link', { name: /^Settings/ }).click();
    await expect(page.locator('#settings-updates')).toContainText('mJournal 9.9.9 is out. You have');
    await expect(page.getByRole('status', { name: 'New version' })).toHaveCount(0);
    expect(requests).toHaveLength(1);
  } finally {
    github.close();
  }
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
