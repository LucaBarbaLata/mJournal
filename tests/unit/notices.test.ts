import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { buildNotices, OUTPUT } = require('../../scripts/notices.cjs') as { buildNotices: () => string; OUTPUT: string };

describe('THIRD-PARTY-NOTICES.txt', () => {
  it('covers every package that ships inside mJournal', () => {
    const notices = buildNotices();
    for (const name of ['react ', 'react-dom ', 'scheduler ', 'yazl ', 'yauzl ', '@fontsource-variable/fraunces ']) {
      expect(notices).toContain(`\n${name}`);
    }
  });

  it('is up to date (run `npm run notices` after changing dependencies)', () => {
    expect(readFileSync(OUTPUT, 'utf8').replace(/\r\n/g, '\n')).toBe(buildNotices());
  });
});
