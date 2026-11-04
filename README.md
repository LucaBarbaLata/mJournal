<p align="center">
  <img src="build/icon.png" width="96" alt="The mJournal app icon: a cream letter m with a small sparkle on a pink-to-lavender tile">
</p>

<h1 align="center">mJournal</h1>

<p align="center"><em>My life doesn’t have to be perfect for it to be beautiful.</em></p>

mJournal is a private journal for your computer — a cozy place to notice the little things: a good conversation, a quiet
moment, something you’re proud of, a song that fit the day. It runs entirely on your laptop, needs no account, and
never sends your writing or photos anywhere.

![Today’s page in mJournal: the date and a greeting, today’s question with an answer, a mood check-in with energy, free writing and photos](docs/screenshots/today.png)

## What you can do

- **Today’s page** — a warm greeting, a daily question that stays the same all day (ask for another one or skip it,
  no guilt), optional extra prompts from a library of 176 questions or your own, free writing on a lined page, and
  photos. Everything saves as you type, with a clear *Unsaved → Saving → Saved* indicator.
- **Mood & energy** — ten friendly moods (rename, reorder, hide or add your own), a 1–5 energy scale and an optional
  note. A mood on its own is enough for a day.
- **Calendar** — a month view with moods and small markers for writing, photos and favorites. Jump to any month or
  year, preview a day, open it. Days without an entry simply stay plain.
- **Journal** — every saved day, newest first, with local full-text search and filters for dates, month, mood,
  photos and favorites.
- **Memories** — a scrapbook-style gallery of your photos by month, with captions and a larger viewer that links
  back to the day.
- **Monthly** — a letter to yourself: what you recorded (clearly labelled as data), the month’s photos, a few moments
  picked by simple published rules, and your own reflection.
- **Insights** — gentle numbers: an optional streak, days per month, mood history, average energy and a year in moods.
  No points, no penalties.
- **Backups** — complete backups in one `.zip`, a careful restore, JSON and CSV export, and daily safety snapshots.
- **An optional PIN** — mJournal asks for it whenever it opens, after a while without use, and when your computer goes
  to sleep. *Ctrl+L* locks it right away.
- **A welcome guide** — five short steps on the first start: your name, how a day works, where things live, privacy,
  and your theme and font. Skip it any time, and open it again from *Settings → Guide & tips*. After the guide, each
  page shows one small tip until you click *Got it*.
- Light and dark (“evening journal”) themes, three writing fonts and keyboard shortcuts.
- Gentle animations: pages slide in, cards appear one after another, and little sparkles or hearts show up when you
  pick a mood, favorite something or save your first words of the day. They switch off with your system’s setting
  for fewer animations (on Windows, *Animation effects*) or *Settings → Appearance → Reduce motion*.
- For Windows and Linux.

<table>
  <tr>
    <td><img src="docs/screenshots/calendar.png" alt="The calendar: a month of days with mood faces and markers, and a preview of the selected day"></td>
    <td><img src="docs/screenshots/memories.png" alt="Memories: photos shown as polaroids with handwritten dates and captions"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/monthly-dark.png" alt="The monthly reflection in the dark theme: the month’s photos and moments to revisit"></td>
    <td><img src="docs/screenshots/insights.png" alt="Insights: streak tiles, days journaled per month and the moods recorded"></td>
  </tr>
</table>

## Install and open

### Download

Get the newest version from the **[Releases page](https://github.com/LucaBarbaLata/mJournal/releases/latest)**.

**Windows 10 or 11**

- **`mJournal-Setup-<version>.exe`** — installs mJournal for your Windows user (no administrator rights needed) with a
  Start menu entry and a desktop shortcut. *Recommended for everyday use.*
- **`mJournal-<version>-portable.exe`** — runs without installing. It starts a little more slowly because it unpacks
  itself each time.

Then open mJournal from its desktop shortcut or the Start menu (or double-click the portable `.exe`).

**Linux (64-bit Intel/AMD)**

- **`mjournal_<version>_amd64.deb`** — installs mJournal into the app menu on Ubuntu, Zorin OS, Linux Mint, Debian and
  other systems based on them. Double-click it to open it in your software installer, or run
  `sudo apt install ./mjournal_<version>_amd64.deb`. *Recommended on those systems.*
- **`mJournal-<version>.AppImage`** — one file that runs on most other distributions without installing. Allow it to
  run first: right-click → *Properties* → *Permissions* → *Allow executing file as program* (or
  `chmod +x mJournal-<version>.AppImage`), then double-click it.

**Checking a download:** `SHA256SUMS.txt` on the same page lists every file’s checksum. On Windows,
`Get-FileHash .\mJournal-Setup-<version>.exe` in PowerShell should print the same value; on Linux, run
`sha256sum -c SHA256SUMS.txt --ignore-missing` in the download folder.

> **“Windows protected your PC”** — Windows shows this for apps that aren’t code-signed. Choose **More info →
> Run anyway**. mJournal isn’t signed because signing certificates cost money every year, which doesn’t fit a free
> hobby project. Every release is built from this source code by GitHub Actions
> ([.github/workflows/release.yml](.github/workflows/release.yml)), so you can see exactly what went into it.

### Build it yourself with one double-click

1. Double-click **`Build mJournal.cmd`** in this folder.
   The first build downloads about 300 MB of tools and takes a few minutes. If Node.js isn’t installed, a private copy
   is downloaded into `.tools\` (checked against its official checksum) — nothing is installed system-wide.
2. When it finishes, the `release` folder opens with the same two files as on the Releases page.

**On Linux**, open a terminal in this folder and run `bash build-mjournal.sh`. It works the same way: if Node.js 22.12
or newer isn’t installed (Ubuntu-based systems ship an older one), a private copy is downloaded into `.tools/`. The
`.deb` and the AppImage end up in `release/`.

### Updating

About once a day mJournal asks GitHub whether a newer version is out, and if so a small note appears in the sidebar.
It never downloads or installs anything by itself: *Get it* opens the Releases page in your browser. Download the new
installer (or `.deb`) and run it — it replaces the app and **keeps your journal**. (For the portable version or the
AppImage, replace the old file.) You can turn the check off, or check right away, in **Settings → Updates**.

### For developers

```powershell
npm ci
node node_modules/electron/install.js   # fetches the Electron runtime (otherwise done on first run)
npm run dev                              # live-reloading app; uses %APPDATA%\mJournal-dev (Linux: ~/.config/mJournal-dev), never your real journal
```

See [Development](#development) for tests and builds.

## Where your journal is stored

| What                                        | Where on Windows                                                        | Where on Linux                  |
| ------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------- |
| Your journal: database, photos, backups     | `%APPDATA%\mJournal` — e.g. `C:\Users\<you>\AppData\Roaming\mJournal`   | `~/.config/mJournal`            |
| Browser-engine cache (no journal content)   | `%LOCALAPPDATA%\mJournal\Chromium`                                      | `~/.cache/mJournal/Chromium`    |

Inside the journal folder:

| Path                              | Contents                                                                               |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `mjournal.db`                     | SQLite database: days, moods, answers, monthly reflections, settings, photo references |
| `lock.json`                       | Only if you set a PIN: a scrambled (hashed) form of it — never the PIN itself          |
| `photos\`                         | Copies of your photos, named after their content (identical photos are stored once)    |
| `thumbnails\`                     | Small previews — only a cache, safe to delete                                          |
| `backups\automatic\`              | Daily safety snapshots of the database (newest ten) and copies made before upgrades    |
| `backups\previous-journal-…\`     | Your previous journal, kept whenever you restore a backup                              |
| `logs\mjournal.log`               | A small technical log. It never contains your writing, moods, captions or photos       |

**Settings → Data & privacy** shows the exact path and has an *Open data folder* button.

- **Portable mode:** create a folder named `mJournal Data` next to `mJournal-<version>-portable.exe` (or next to the
  AppImage on Linux) and mJournal keeps everything inside it — handy for a USB stick.
- **Another location:** set the environment variable `MJOURNAL_DATA_DIR` to a folder before starting mJournal.
- **Uninstalling never deletes your journal.**

## Backups, restore and export

All of these live in **Settings → Backup & export**.

- **Complete backup** — *Create backup…* writes one file, `mJournal-backup-YYYY-MM-DD-HHMM.zip`, containing a
  manifest, a consistent copy of the database and every photo. Keep it somewhere else: a USB drive, another disk.
- **Restore** — *Restore…* first checks the backup: every file name must be one mJournal expects (no hidden or
  absolute paths, no links), every file must match its SHA-256 checksum, and the database must pass SQLite’s
  integrity check. You then see what’s in it next to what you have now, and nothing changes until you confirm.
  Restoring **replaces** your journal — it does not merge. Your current journal is moved, not deleted, to
  `backups\previous-journal-…`, so you can always go back.
- **Daily safety snapshots** — once a day mJournal keeps a copy of the database in `backups\automatic` (the newest ten
  are kept). Photos aren’t copied there because mJournal never deletes them silently. To use a snapshot: close
  mJournal, move the current `mjournal.db` somewhere safe, copy the snapshot into its place and rename it to
  `mjournal.db`.
- **Export** — *JSON* contains everything in a structured form; *CSV* has one row per day and opens in a spreadsheet.

## Privacy

- **Local only.** No account, no cloud sync, no analytics, telemetry or ads. Your writing, moods and photos never
  leave your computer; fonts and icons are bundled, and search, statistics and backups all run locally.
- **One question to the internet.** The only request mJournal makes is the update check: about once a day it asks
  GitHub (`api.github.com`) which version was released last. Like any web request it reveals your IP address to
  GitHub, but it carries nothing about you or your journal — no cookies, no ids, just “mJournal”. Turn it off in
  **Settings → Updates** and mJournal never goes online at all.
- **Not encrypted at rest.** Your journal is stored as ordinary files in your user folder. Anyone who can sign in to
  your account — or read your disk — can read them. Protect it with a password on your account and turn on disk
  encryption: on Windows, *BitLocker* or *Device encryption* in Windows settings; on Linux, full-disk encryption, which
  is usually set up while installing the system. Backups and exports aren’t encrypted either, so keep them somewhere
  private.
- **The PIN keeps mJournal closed, not encrypted.** With a PIN (*Settings → PIN lock*), mJournal shows only its lock
  screen until the right PIN is entered: nothing of your journal is loaded, and the part of mJournal that reads your
  files refuses to while it’s locked. That keeps out people who use your computer while you’re away. It isn’t
  encryption: someone who can open your files directly could still read them, so the advice above still applies. The
  PIN is stored only as a salted *scrypt* hash, in `lock.json` — not in backups, so restoring one never changes your
  PIN. After five wrong tries mJournal asks for a pause, which grows to 15 minutes, even across restarts.
- **Careful by design.** The interface runs in a sandbox with a strict content-security policy and can only call a
  fixed list of functions, each of which validates its input. Photos are served by id, never by file path. New
  windows, navigation and permission requests (camera, microphone, location…) are blocked. In the built app,
  Electron’s security switches prevent it from being run as a plain Node.js program, from being debugged via command
  line flags, and from loading code other than its own verified package.

## How mJournal counts things

- A day counts as **journaled** when anything was saved for it: a mood, energy, some words or a photo.
- Your **current streak** is the number of days in a row up to today. If today is still empty, a streak that ended
  yesterday still counts — the day isn’t over. A missed day is simply a day without an entry.
- The **daily question** is chosen from the date, avoiding questions shown in the 90 days around it, and is remembered
  once shown — reopening the app never changes it.
- **Moments** in the monthly recap come only from: days you marked as favorites, answers you saved as favorite
  moments, your longest entry (40+ words) and days with three or more photos. mJournal never writes or guesses
  anything about how you felt.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| “Windows protected your PC” | Choose **More info → Run anyway** (the app isn’t code-signed). |
| mJournal says it couldn’t open your journal | Nothing has been deleted. *Open data folder* to look around, or *Set it aside and start a new journal*: the database is moved to `backups\damaged-journal-…`, and you can then restore a complete backup from Settings. |
| “This journal was saved by a newer version of mJournal” | Your data is untouched. Install the newer version from the [Releases page](https://github.com/LucaBarbaLata/mJournal/releases/latest). |
| Settings → Updates says GitHub couldn’t be reached | You’re offline, or a firewall blocks `api.github.com`. Nothing else is affected; mJournal tries again a few hours later. |
| Forgot your PIN | Close mJournal, open the data folder (see [Where your journal is stored](#where-your-journal-is-stored)) and delete `lock.json`. mJournal then opens without a PIN, and your journal is exactly as it was. Set a new PIN in *Settings → PIN lock*. |
| A photo shows “Photo unavailable” | Its file is missing from `photos\` (Settings → Data & privacy counts these). Restoring a complete backup brings it back. |
| iPhone photos (HEIC) are rejected | Save them as JPEG first — on the iPhone: *Settings → Camera → Formats → Most Compatible*; or open them in the Windows Photos app and *Save as* JPEG. |
| The evening reminder doesn’t appear | It only works while mJournal is open (minimized is fine), stays quiet on days you’ve already written, and can be hidden by Windows *Do not disturb*. It works best with the installed version. |
| `Build mJournal.cmd` or `build-mjournal.sh` fails | Check your internet connection (it downloads from npm, nodejs.org and GitHub), delete the `node_modules` folder and run it again. |
| Linux: double-clicking the AppImage does nothing | Allow it to run first: right-click → *Properties* → *Permissions* → *Allow executing file as program*, or `chmod +x mJournal-<version>.AppImage`. |
| Linux: the AppImage runs, but you’d like the full sandbox | Ubuntu 24.04 and systems based on it only let installed apps use the kernel feature Chromium’s sandbox needs, so there the AppImage starts with that sandbox switched off rather than not at all. Install the `.deb` instead: it sets the sandbox up properly. |
| Linux: no spelling suggestions | Spell checking is off on Linux for now: Chromium would download its dictionaries from Google, and mJournal doesn’t go online for that. |
| Something else | `logs\mjournal.log` in the data folder records technical errors (never journal content). |

## Development

**Requirements:** Windows 10 or 11, or 64-bit Linux, and Node.js 22.12 or newer (24 LTS recommended) — or let
`Build mJournal.cmd` / `build-mjournal.sh` fetch one.

| Command | What it does |
| --- | --- |
| `npm ci` | Installs the exact pinned dependency versions from `package-lock.json` |
| `npm run dev` | Starts the app with live reload (data in `%APPDATA%\mJournal-dev`) |
| `npm test` | Unit and integration tests (Vitest) — dates, streaks, prompts, database, photos, search, stats, exports, migrations, backup & restore |
| `npm run test:e2e` | Builds the app, then drives the real app with Playwright in throwaway data folders |
| `npm run typecheck` | Type-checks the main process, interface and tests |
| `npm run dist` | Builds the installer and the portable `.exe` into `release\` (on Windows) |
| `npm run dist:linux` | Builds the `.deb` and the AppImage into `release/` (on Linux) |
| `npm run icons` | Re-renders `build\icon.ico` and the PNG icons from `build\icon.svg` |
| `npm run notices` | Rewrites `THIRD-PARTY-NOTICES.txt` after dependencies change (a unit test reminds you) |
| `npm run verify` | Type-check, unit tests and end-to-end tests in one go |

### Releasing a version

1. Raise the version (skip this for the first release, 1.0.0), then commit and push:

   ```powershell
   npm version patch --no-git-tag-version   # or minor / major: updates package.json and package-lock.json
   ```

2. On GitHub, open **Actions → Release → Run workflow** and pick what to make:
   - **draft** — only you can see it. Download and try the installers, then press *Publish release* on GitHub.
   - **pre-release** — public, but the app’s update check ignores it: a release candidate for testers.
   - **release** — public, and everyone’s mJournal mentions it in the sidebar.

[.github/workflows/release.yml](.github/workflows/release.yml) type-checks and tests everything on Windows and on Linux,
builds the installer and the portable app on Windows and the `.deb` and the AppImage on Linux, and puts all four on the
Releases page with a `SHA256SUMS.txt`. If either system’s tests or build fail, nothing is published. The `v1.0.0`-style tag is
created when the release is published. Running it again for the same version replaces a draft. Running it with
**release** while that version is a pre-release turns the pre-release into the release, without building again, as
long as the app hasn’t changed since (edits to `.github/`, `docs/` and Markdown files don’t count). A version that is
already released stops right away and asks you to raise the version. The repository has to be public for people to
download releases and for the update check to see them.

### Stack

mJournal is an [Electron](https://www.electronjs.org/) app: a React + TypeScript interface on top of a small Node.js
core that owns the database and files. SQLite comes from Node’s built-in `node:sqlite` module, so there are no
compiled add-ons to build. The full reasoning, data model and security model are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

| Dependency | Why |
| --- | --- |
| `electron` | Desktop window and its own Chromium — works offline, looks the same everywhere |
| `react`, `react-dom` | Interface components |
| `yazl`, `yauzl` | Writing and safely reading backup `.zip` files |
| `@fontsource-variable/*` | Fraunces, Nunito and Caveat fonts, bundled so nothing loads from the internet |
| `electron-vite`, `vite`, `@vitejs/plugin-react`, `typescript` | Build tooling |
| `electron-builder` | Windows installer and portable `.exe`, Linux `.deb` and AppImage |
| `vitest`, `@playwright/test` | Tests |

All versions are pinned exactly in `package.json`.

### Project layout

```text
src/
  core/        Pure, tested logic shared by both sides: dates, moods, prompts, streaks, search, validation, API contract
  main/        Electron main process
    store/     SQLite access: migrations, entries, prompts, moods, photos, reflections, search, stats, settings
    services/  Photo files, backups, restore, snapshots, exports, the update check
    api.ts     Validates every call from the interface      host.ts  Owns the journal (and restores)
    index.ts   App start-up, data folder, window             protocols.ts  app:// and mj-media://
  preload/     The narrow bridge exposed to the interface
  renderer/    React interface: views/, components/, lib/, styles/ (design tokens in styles/tokens.css)
tests/unit/    Vitest tests          tests/e2e/   Playwright tests of the real app
build/         Icon sources and packaging resources
scripts/       Icon rendering, third-party notices and the Node.js downloads used by Build mJournal.cmd and build-mjournal.sh
.github/       The release workflow
```

## Known limitations

- The journal isn’t encrypted at rest (see [Privacy](#privacy)); the PIN keeps mJournal closed, not the files.
- Restoring a backup replaces the whole journal; there’s no merging of two journals.
- One entry per day (with any number of prompts and photos).
- HEIC/HEIF photos aren’t supported.
- The evening reminder needs mJournal to be running.
- Built and tested on Windows 11. Linux packages (64-bit Intel/AMD only) are new in 1.1 and are tested automatically on
  Ubuntu 24.04. macOS packaging is configured but hasn’t been tested.
- Spell checking isn’t available on Linux.
- The app isn’t code-signed, so Windows shows a SmartScreen warning the first time.
- Updates are installed by hand: mJournal tells you about a new version but doesn’t download it.
- The interface is in English.

## License

mJournal is free and open source under the [MIT License](LICENSE). It includes React and the Fraunces, Nunito and
Caveat fonts (SIL Open Font License), among others; their licenses are collected in
[THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt), which also ships next to the app’s executable.
