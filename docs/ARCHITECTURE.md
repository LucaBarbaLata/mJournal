# mJournal architecture

This document is for developers working on mJournal. The [README](../README.md) covers installing and using it.

## Why this stack

mJournal is a desktop **Electron** app with a **React + TypeScript** interface and **SQLite** storage.

- **A designed interface.** The product depends on its look and feel (cream paper, soft type, hand-drawn moods,
  animation that respects reduced motion). HTML and CSS give full control over that, and Electron ships its own
  Chromium, so it renders the same on every machine and works offline.
- **Real local storage without a server.** The main process reads and writes the SQLite file and photo folder
  directly. There is no local web server and no open port; the interface talks to the main process over IPC only.
- **One-click distribution.** `electron-builder` produces a per-user installer and a portable `.exe` for Windows,
  and a `.deb` and an AppImage for Linux.
- **Testable end to end.** Playwright can drive the real app, so the important flows are tested as a user would use
  them.
- **No compiled add-ons.** SQLite comes from Node’s built-in `node:sqlite` (present in Electron 44’s Node 24), so
  `npm ci` never compiles native code, and unit tests run on the very same SQLite engine.

Alternatives considered: Tauri (needs a Rust toolchain, harder to drive with test automation), a localhost server with
the system browser (opens a port that other software could reach, and feels like a website), WPF/WinUI (Windows-only
and much harder to make look designed), Python with pywebview (depends on platform-specific bridges).

## Processes

```mermaid
flowchart LR
  subgraph Renderer["Renderer (sandboxed, no Node.js)"]
    UI["React views<br/>src/renderer"]
  end
  subgraph Preload["Preload"]
    Bridge["window.mjournalIpc / mjournalNative<br/>src/preload"]
  end
  subgraph Main["Main process (Node.js)"]
    IPC["ipc.ts<br/>sender check, error envelope"]
    API["api.ts<br/>validates every argument"]
    Host["host.ts / journal.ts"]
    Stores["store/*<br/>SQLite"]
    Services["services/*<br/>photos, backup, restore, export"]
    Proto["protocols.ts<br/>app:// and mj-media://"]
  end
  Disk[("Data folder<br/>mjournal.db, photos/, backups/")]
  UI -- "invoke(channel, …args)" --> Bridge --> IPC --> API --> Host --> Stores --> Disk
  Host --> Services --> Disk
  UI -- "img src=mj-media://photo/ID" --> Proto --> Disk
```

- `src/core` is pure TypeScript with no Node.js or DOM APIs. It compiles under both the main-process and interface
  configs, so it can’t accidentally depend on either. It holds dates, streak rules, the prompt library and its
  selection, mood definitions, text helpers, input validation and the **API contract** (`core/api.ts`).
- `src/main/journal.ts`, `host.ts`, `store/*` and `services/*` don’t import Electron. Tests open real journals in
  temporary folders, including the complete backup → restore flow.
- Electron-specific code is limited to `main/index.ts`, `window.ts`, `protocols.ts`, `platform.ts`, `ipc.ts` and
  `reminders.ts`.

### The API contract

`core/api.ts` defines `MJournalApi` (typed methods per namespace) and `API_METHODS` (the list of method names, checked
against the interface at compile time). The preload exposes exactly those methods; `main/ipc.ts` registers exactly
those channels; `main/api.ts` implements them, treating every argument as `unknown` and validating it with
`core/validation.ts`. Errors that are safe to show are `UserFacingError`s; anything else is logged (the error only,
never the arguments) and reported as a generic message.

## Data model (schema version 1)

All tables are SQLite `STRICT` tables. The schema version is `PRAGMA user_version`.

| Table | Purpose |
| --- | --- |
| `entries` | One row per calendar day (`date` = `YYYY-MM-DD`): free writing, mood key, mood note, energy 1–5, favorite. Derived columns (`word_count`, `has_text`, `answer_count`, `photo_count`, `favorite_moments`) are refreshed in the same transaction as every change; `has_content` is a generated column and is the single definition of “this day counts”. |
| `answers` | Prompt answers per day, with a copy of the question’s wording (`prompt_text`) so edits to custom prompts never change old answers. |
| `photos` | Photo rows: day, content hash, stored file, caption, order, favorite, thumbnail flag, `removed_at` for “Recently removed”. No foreign key to `entries`, so deleting a day keeps its photos recoverable. |
| `daily_prompts` | The featured question shown for each date (saved on first view), with shuffle count and “skipped”. |
| `prompt_prefs` | Favorite / hidden flags for any prompt id. |
| `custom_prompts` | The user’s own questions (archived rather than deleted). |
| `moods` | The mood vocabulary: label, icon, color, order, hidden, built-in. Moods are hidden, never deleted. |
| `monthly_reflections` | Answers to the monthly questions and the “Dear me” letter, per month. |
| `settings` | JSON values per key, re-validated on read (malformed values fall back to defaults). Keys starting with `internal.` hold things like the window size. |

The PIN lock is deliberately **not** in the database: it lives in `lock.json` next to it (see *The PIN lock* below).
| `search_index` | FTS5 table (`body`, `answers`, `notes`), rowid = the day number of the date. |

### Migrations

`store/migrations.ts` holds an ordered list of migrations. On start-up:

1. If the database is from a **newer** version, mJournal refuses to open it and changes nothing.
2. If a migration is needed and the database already has data, a full snapshot is written to
   `backups/automatic/mJournal-before-migration-v<N>-<time>.db` first.
3. Each migration runs in its own transaction together with its `user_version` bump. A failure rolls back
   completely.
4. Derived columns and the search index are rebuilt.

**To change the schema:** append a new migration with the next version number. Never edit a released one. Add a
test next to the ones in `tests/unit/migrations.test.ts`.

## Important flows

### Saving while writing

`renderer/lib/saveQueue.ts` debounces edits per field (`body:<date>`, `answer:<date>:<prompt>`, …) for 650 ms, runs
saves for the same field in order, keeps failed saves for retry and drives the save indicator. Before the window
closes, the main process asks the interface to flush (`window.ts`, with a 3-second safety timeout).

SQLite runs in WAL mode with `synchronous = FULL`, so a committed save survives a crash or power cut.

### Photos

1. The main process reads the picked or dropped file (size limit 25 MB), identifies it by its first bytes (JPEG, PNG,
   WebP, GIF, AVIF; HEIC is recognised and politely rejected) and hashes it.
2. The bytes are written atomically to `photos/<first 2 hex>/<sha256>.<ext>` unless that file already exists.
   Identical photos are therefore stored once, and two photos can never collide.
3. The interface fetches the original through `mj-media://photo/<id>`, decodes it with Chromium (respecting EXIF
   orientation), scales it down and sends back a WebP thumbnail, stored as `thumbnails/<sha256>.webp`.
4. Removing a photo sets `removed_at`. Deleting it permanently is a separate, confirmed step, and the file is only
   deleted when no other photo row uses it. Originals on the user’s disk are only ever read.

### Complete backup and restore

- `services/backup.ts → writeBackup` writes `mjournal-backup.json` (manifest with counts and SHA-256 of every file), a
  `VACUUM INTO` copy of the database and every referenced photo into a `.partial` file, flushes it, then renames it
  into place.
- `stageBackup` only accepts entry names from an allowlist, rejects links, encrypted entries, duplicates and oversized
  archives, cross-checks the archive against its manifest, extracts into `.tmp/restore-*` while verifying sizes and
  hashes, then opens the extracted database and runs `PRAGMA integrity_check`.
- `host.ts → restore` closes the journal, moves the current database and photos to
  `backups/previous-journal-<time>/`, moves the staged files in and reopens. If any step fails, every move is undone
  and the original journal is reopened.

### Motion, the welcome guide and tips

- Animations are CSS keyframes in `renderer/styles/motion.css`, imported last. Under reduced motion (the system
  setting, or *Settings → Appearance → Reduce motion*, which adds `reduce-motion` to the root element) the rules at
  the end of `styles/base.css` shorten every animation and transition to 1 ms and drop delays, so nothing ever waits
  on an animation. `renderer/lib/motion.ts` holds the JavaScript side (particle bursts, count-up numbers, the theme
  cross-fade, the slide direction for previous/next) and every helper there does nothing under reduced motion.
- The welcome guide (`renderer/views/Onboarding.tsx`) is a modal `<dialog>` shown while the `onboardingDone` setting
  is false; finishing or skipping it sets the flag. One-time tips (`renderer/components/Tip.tsx`) only appear after
  the guide, and dismissing one adds its id to the `dismissedTips` setting.

## Security model

- Renderer: `sandbox`, `contextIsolation`, no `nodeIntegration`, strict Content-Security-Policy (no inline scripts, no
  remote origins), served from the custom `app://mjournal` scheme rather than `file://`.
- IPC: only the listed channels, only from the app’s own origin, every argument validated.
- Media: `mj-media://photo/<id>` looks files up by id in the database; arbitrary paths can’t be requested. CORS is
  limited to the app origin.
- Navigation, `window.open`, `<webview>` and all permission requests are blocked.
- Packaged app: Electron fuses disable `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and inspector flags, and enforce asar
  integrity and loading only from the asar.
- Logs never contain journal content. There is no telemetry. The only network request is the update check (below);
  the interface itself can’t reach the network at all (its content-security policy allows no remote origins).
- Optional PIN lock (below). It keeps mJournal's window closed; it is not encryption.
- Not done: encryption at rest. Protecting the journal relies on the operating system account and disk encryption.

### The PIN lock

The lock keeps other people who use the computer out of mJournal. It does not protect the files themselves.

- **Where it lives.** `main/lock.ts` (`AppLock`, Electron-free and unit-tested) keeps the PIN only as a scrypt hash
  (N = 2¹⁵, r = 8, p = 1, random 16-byte salt) in `lock.json` in the data folder, written atomically. It is outside the
  database on purpose: backups don't contain it and a restore never changes it. Deleting the file while mJournal is
  closed removes the PIN; that's the documented way back from a forgotten one. A file that can't be read (or has
  out-of-range scrypt parameters) counts as no PIN, which is what deleting it would do anyway.
- **Enforced by the main process.** With a PIN, mJournal starts locked. `createApi` wraps every handler except
  `lock.status`, `lock.unlock` and `lock.lock` (`OPEN_WHILE_LOCKED`) so it fails with `locked`, and `mj-media://`
  answers 404. The interface can't read the journal while locked, whatever it does.
- **Wrong PINs.** Five are free, then pauses of 30 s, 1 min, 5 min and 15 min from then on (`core/lock.ts`). The count
  and the end of the pause are saved in `lock.json`, so a restart doesn't reset them. Checks run one at a time, so
  tries sent in parallel can't get past a pause. Tries during a pause aren't checked at all.
- **In the interface.** `renderer/lib/lock.tsx` (`LockProvider`) sits above `AppProvider`. While locked it renders
  only `views/LockScreen.tsx`, so no journal data is loaded or kept in React state. Locking always saves pending
  edits first (`saveQueue.flush()`). It locks from *Lock*/*Ctrl+L*, after the chosen minutes without input (keys,
  pointer, wheel), and when the main process sends `lock-request` on system `suspend` or `lock-screen`. If the
  window doesn't lock within 3 seconds, the main process locks on its own and sends `lock-changed`. The
  save-before-close listener lives in `App`, above the lock, so closing a locked window doesn't wait.

### The update check

`main/services/updates.ts` (`UpdateChecker`) decides *when*: about 3 seconds after every start, then a day after the
last answer while mJournal stays open (the last answer is kept in the `internal.updateCheck` setting, so Settings can
show it before the first check), a few hours after a failure, and never while *Check for new versions* is off. Turning
it on checks within seconds if this start hasn’t asked yet. *Check now* asks right away. `main/index.ts` makes the
request: a plain `GET` of GitHub’s latest-release API from the main process, in its own in-memory session (no cookies,
no cache), with the user agent `mJournal`. `core/updates.ts` compares the version numbers. Development builds don’t
check automatically; end-to-end tests point `MJOURNAL_UPDATE_URL` at a local server (only honoured when the app isn’t
packaged).

Nothing is downloaded until the person clicks *Update*. `main/services/updateInstaller.ts` (`UpdateInstaller`) then
downloads, through the same session, the release’s `SHA256SUMS.txt` and the one file this copy needs, both from fixed
`github.com/…/releases/download/v<version>/` addresses built from the version number (never an address taken from an
answer), and checks the file’s SHA-256 before using it. `installTarget()` in `main/index.ts` decides how this copy
updates:

- **Windows, installed** (the uninstaller is beside `mJournal.exe`, `PORTABLE_EXECUTABLE_FILE` isn’t set): the
  installer is saved in `%TEMP%\mJournal-update`. mJournal closes the usual way (saving what is being typed, closing the
  journal) and, on the app’s `quit` event, starts `mJournal-Setup-<version>.exe --updated /S --force-run`: electron-builder’s
  installer then updates the same folder without its windows and opens mJournal again. The next start removes the
  folder.
- **AppImage** (`APPIMAGE` is set): the new AppImage is downloaded beside the old one, made executable and renamed over
  it, so its path (and any shortcut to it) stays the same. Once mJournal has ended, `/bin/sh` waits for its process to
  go and starts the new file; `app.relaunch()` can’t be used, because the old AppImage’s files vanish when it ends.
- **`.deb`** (`/opt/mJournal/mjournal`, and dpkg knows the `mjournal` package): the package goes into a private
  `mkdtemp` folder and is installed with `pkexec /usr/bin/apt-get install -y <file>`, so the system asks for the
  password. Then `app.relaunch()` and quit.
- **Portable app, development builds, other systems or processors:** no installer; *Get it* opens the fixed
  releases-page address with `shell.openExternal`.

`UpdateChecker.install()` reports the steps as `downloading` (with whole-percent progress) and `installing`; a failure
returns to `available` with `installError`, and mJournal stays open.

How it went is the status’s `result`, which the renderer shows in a window (`UpdateResultDialog`) after the welcome
guide and the PIN. A failure while mJournal is open sets it right away, with the reason. For the rest, `installing`
first saves `{ version, previous }` in the `internal.pendingUpdate` setting, because mJournal closes to install: the next
start reads it and calls the update `installed` if it now runs that version or a newer one, otherwise `failed` (the
installer was cancelled, or Windows’ permission prompt declined). The setting is cleared when the person closes the
window (`updates.dismissResult`) or starts another update, so a start that ends at the lock screen still shows it the
next time.

## Linux

Most of mJournal doesn’t care which system it runs on; the differences are kept in `main/index.ts` and `main/window.ts`.

- **Folders.** The journal lives in `~/.config/mJournal` (Electron’s `appData`), the browser engine’s caches in
  `$XDG_CACHE_HOME/mJournal/Chromium` (usually `~/.cache`). A `mJournal Data` folder next to the AppImage (found
  through the `APPIMAGE` variable its runtime sets) works like the one next to the portable `.exe`.
- **Packages.** A `.deb` and an AppImage, x64 only. `desktopName` in `package.json` together with
  `linux.syncDesktopName` makes the window, the menu entry (`mjournal.desktop`) and the dock icon belong together.
- **Chromium’s sandbox.** Ubuntu 24.04 and systems based on it only allow the kernel feature the sandbox needs for
  programs with an AppArmor profile. The `.deb` installs one (electron-builder’s after-install script). The AppImage
  can’t, so its runtime (toolset `1.0.3`) starts the app with `--no-sandbox` only on such systems; the older runtime
  did so everywhere. The README recommends the `.deb` for that reason.
- **No keyring.** mJournal stores no cookies or passwords, so it starts Chromium with `--password-store=basic`, which
  avoids a keyring password prompt on some desktops.
- **No spell checking.** Chromium on Linux has no system spell checker to use and would download Hunspell
  dictionaries from Google, so `spellcheck` is off there (and the download address points nowhere, just in case).

## Releases

`.github/workflows/release.yml` is started by hand (*Run workflow*) with a choice of draft, pre-release or release.
A short `check` job (Linux) looks at the Releases page first: it stops if the version in `package.json` is already
released, and with *release* it turns an existing pre-release of that version into the release (`gh release edit`)
instead of rebuilding, provided nothing outside `.github/`, `docs/` and Markdown changed since its tag. Otherwise two build jobs run side by side: `windows` runs `npm ci`, `npm run verify` and `npm run dist`;
`linux` (Ubuntu 24.04) runs the same tests under `xvfb-run` and builds with `npm run dist:linux`. electron-builder can’t
make Linux packages on Windows, hence the second runner. As soon as `windows` is done, `virustotal` uploads its two
`.exe` files with the VirusTotal API (key in the `VT_API_KEY` secret, kept out of the job that can write releases),
waits for the scans and hands on Markdown links to `virustotal.com/gui/file/<sha256>`. Only if all three succeed does
`publish` collect the files, write `SHA256SUMS.txt` and create the release `v<version>` at the built commit with
`gh release create` (replacing an earlier draft of the same version); its notes are GitHub’s generated changelog
(`releases/generate-notes`) followed by the VirusTotal links. There is deliberately no tag
trigger: publishing a draft creates its tag, which would otherwise start a second run. The update check reads GitHub’s
“latest release”, which never includes drafts or pre-releases. electron-builder itself never publishes
(`publish: null`), so no auto-update metadata is produced.

`THIRD-PARTY-NOTICES.txt` is generated from `node_modules` by `scripts/notices.cjs` (`npm run notices`) and shipped next
to the executable together with `LICENSE`; `tests/unit/notices.test.ts` fails when it is out of date.

## Testing

- `tests/unit` (Vitest, plain Node.js with the same `node:sqlite`): calendar maths across month, year and leap-day
  boundaries; streak rules; prompt library and deterministic selection; entries and answers; moods; settings;
  photos (types, size limit, duplicate names, dedupe, missing files, removal, thumbnails); search and filters; stats;
  JSON and CSV export (including formula escaping); migrations (upgrade, rollback, newer version, unreadable file);
  backup and restore (round trip, cancel, corrupted, truncated, path traversal, absolute paths, links, unexpected
  files, tampered manifest, database or photos); API validation; version comparison and update-check scheduling (with
  fake timers); the PIN lock (hashing, pauses across restarts, tries sent in parallel, a damaged lock file, restoring a
  backup) and every API method refusing to run while locked; third-party notices being up to date.
- `tests/e2e` (Playwright driving the built app with a temporary `MJOURNAL_DATA_DIR`): clean start; writing, closing
  the window and reopening; editing earlier days; calendar navigation; photos with duplicate names and thumbnails;
  missing photo files; search and filters; monthly reflection persistence; JSON and CSV export; backup and confirmed
  restore; corrupted backup; theme switching; the welcome guide (with animations on, and in the smallest window);
  one-time tips; the update note (against a local stand-in for GitHub); keyboard-only use; the PIN lock (set in
  Settings, the next start locked with journal requests and photos refused, wrong PIN, Ctrl+L saving first, locking
  after a minute without input with Playwright's fake clock, turning it off). Native dialogs and
  `shell.openExternal` are stubbed in the main process. The other tests run with reduced motion and skip the guide.
  On GitHub Actions each end-to-end test gets one retry, and the whole suite runs on both Windows and Linux.

## How-tos

- **Add a prompt:** append it to the right category in `core/prompts.ts`. Ids are positional within a category, so
  only ever append. Retire a prompt by listing its id in `RETIRED_PROMPT_IDS`, never by deleting it.
- **Add a mood face or symbol:** add the name to `MOOD_ICONS` in `core/moods.ts` and draw it in
  `renderer/components/MoodIcon.tsx`.
- **Change colors or type:** design tokens live in `renderer/styles/tokens.css` (light values on `:root`, dark values
  in the `prefers-color-scheme: dark` block). The window title bar colors are in `core/theme.ts`; keep them in sync
  with `--chrome-bg`.
- **Change the icon:** edit `build/icon.svg` (and `build/icon-small.svg` for 16–24 px), then run `npm run icons`.
- **Add a tip:** place `<Tip id="…">` at the top of a view with a new id (lowercase letters, digits and dashes).
  Never reuse or rename an id: dismissed ids are stored in settings.
