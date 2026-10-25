/**
 * Writes THIRD-PARTY-NOTICES.txt: the license of every package that ships
 * inside mJournal (Electron and Chromium bring their own license files).
 * Run `npm run notices` after changing dependencies; a unit test fails while
 * the file is out of date.
 */
const { readdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');
const OUTPUT = join(ROOT, 'THIRD-PARTY-NOTICES.txt');

// Bundled into the interface by Vite, so they ship even though they're devDependencies.
const BUNDLED = [
  'react',
  'react-dom',
  'scheduler',
  '@fontsource-variable/caveat',
  '@fontsource-variable/fraunces',
  '@fontsource-variable/nunito',
];

/** The production dependencies and everything they depend on, from the lockfile. */
function runtimePackages() {
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  const marker = 'node_modules/';
  return Object.entries(lock.packages)
    .filter(([path, info]) => path.includes(marker) && !info.dev && !info.devOptional)
    .map(([path]) => path.slice(path.lastIndexOf(marker) + marker.length));
}

function licenseText(dir) {
  const file = readdirSync(dir).find((name) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(name));
  if (!file) throw new Error(`No license file in ${dir}`);
  return readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n').trim();
}

function buildNotices() {
  const names = [...new Set([...BUNDLED, ...runtimePackages()])].sort();
  const rule = '='.repeat(78);
  const sections = names.map((name) => {
    const dir = join(ROOT, 'node_modules', name);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return [rule, `${pkg.name} ${pkg.version} (${pkg.license})`, rule, '', licenseText(dir), ''].join('\n');
  });
  return [
    'mJournal - third-party notices',
    '',
    'mJournal includes the open-source software listed below. Electron and Chromium,',
    'which mJournal runs on, come with their own notices: LICENSE.electron.txt and',
    'LICENSES.chromium.html in the mJournal folder.',
    '',
    ...sections,
  ].join('\n');
}

module.exports = { buildNotices, OUTPUT };

if (require.main === module) {
  writeFileSync(OUTPUT, buildNotices());
  console.log(`Wrote ${OUTPUT}`);
}
