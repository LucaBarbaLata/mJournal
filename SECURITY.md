# Security

mJournal keeps people's private writing and photos, so security problems matter even in a small hobby project.
Thank you for reporting them carefully.

## Reporting a problem

Please **don't open a public issue** for a security problem. Report it privately instead:
**[Report a vulnerability](https://github.com/LucaBarbaLata/mJournal/security/advisories/new)** (GitHub's private
reporting; only you and the maintainer can see it).

Include what you found, the steps to reproduce it, the mJournal version (*Settings → Shortcuts & about*) and your
system (Windows 10/11, or which Linux distribution). Please don't send anyone's real journal. Test with a throwaway
journal: start mJournal with `MJOURNAL_DATA_DIR` set to an empty folder.

You'll get an answer as soon as possible. Once a fix is released, the problem is described on the Releases page, and you're
credited if you'd like to be.

## Supported versions

Only the newest release gets fixes. The update check (*Settings → Updates*) tells people when a newer version is out.

## What counts

Examples of what to report:

- The interface (or a backup file, photo or prompt it loads) running code outside its sandbox, reading files other
  than its own, or reaching the internet.
- Getting past the PIN lock screen from inside mJournal, or making mJournal show journal content while it's locked.
- A backup `.zip` that, when restored, writes files outside the journal folder or damages the journal.
- The update check sending anything about the person or their journal.
- *Update* installing a file that doesn't match the release's `SHA256SUMS.txt`, or one from anywhere but the release on
  GitHub.

Known limits, described in the [README](README.md#privacy), that aren't vulnerabilities:

- The journal, backups and exports aren't encrypted. Someone who can read the files on disk can read the journal. The
  PIN keeps mJournal closed; it doesn't encrypt anything, and deleting `lock.json` removes it on purpose (that's
  how a forgotten PIN is reset).
- The app isn't code-signed. Every release is built from this repository by
  [GitHub Actions](.github/workflows/release.yml), and `SHA256SUMS.txt` on the Releases page lets you check a download.
