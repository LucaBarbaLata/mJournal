import { describe, expect, it } from 'vitest';
import { buildCsv, buildJsonExport, csvCell } from '../../src/main/services/exporter';
import { PNG_1PX, openJournal } from './helpers';

describe('JSON export', () => {
  it('contains structured entries, answers, photos, reflections and settings', async () => {
    const journal = openJournal();
    journal.entries.update('2026-10-23', { body: 'A good day', mood: 'happy', energy: 4, favorite: true });
    journal.entries.saveAnswer('2026-10-23', { promptId: 'joy-02', promptText: 'Who or what made me smile?', answer: 'My cat' });
    await journal.photos.importSources('2026-10-23', [{ name: 'cat.png', data: PNG_1PX }]);
    journal.entries.update('2026-10-24', { body: '' }); // empty day is not exported
    journal.reflections.save('2026-10', 'proud', 'Finishing the zine');

    const data = buildJsonExport(journal, '1.0.0');
    expect(data).toMatchObject({ app: 'mJournal', kind: 'mjournal-export', exportVersion: 1, appVersion: '1.0.0' });
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0]).toMatchObject({
      date: '2026-10-23',
      mood: 'happy',
      moodLabel: 'Happy',
      energy: 4,
      energyLabel: 'High',
      favorite: true,
      body: 'A good day',
      answers: [{ promptId: 'joy-02', question: 'Who or what made me smile?', answer: 'My cat', favorite: false }],
      photos: [{ originalName: 'cat.png' }],
    });
    expect(data.entries[0].photos[0].file).toMatch(/^photos\/[0-9a-f]{2}\/[0-9a-f]{64}\.png$/);
    expect(data.monthlyReflections).toMatchObject([
      { month: '2026-10', answers: [{ key: 'proud', question: 'What am I proud of?', answer: 'Finishing the zine' }] },
    ]);
    expect(data.moods).toHaveLength(10);
    expect(data.settings.theme).toBe('system');
    expect(() => JSON.parse(JSON.stringify(data))).not.toThrow();
  });
});

describe('CSV export', () => {
  it('quotes every cell and escapes quotes, commas and line breaks', () => {
    expect(csvCell('plain')).toBe('"plain"');
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell('line one\nline two')).toBe('"line one\nline two"');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(4)).toBe('"4"');
  });

  it('neutralizes spreadsheet formulas but keeps ordinary bullet lists', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell('+1')).toBe('"\'+1"');
    expect(csvCell('@SUM(A1)')).toBe('"\'@SUM(A1)"');
    expect(csvCell('-2+3')).toBe('"\'-2+3"');
    expect(csvCell('- a bullet point')).toBe('"- a bullet point"');
  });

  it('writes one row per saved day with a byte-order mark for Excel', () => {
    const journal = openJournal();
    journal.entries.update('2026-10-23', { body: 'Wrote, with "quotes"\nand two lines', mood: 'calm', energy: 2 });
    journal.entries.saveAnswer('2026-10-24', { promptId: 'joy-01', promptText: 'What was one moment I genuinely enjoyed today?', answer: 'Lunch' });
    const csv = buildCsv(journal);
    expect(csv.startsWith('﻿date,weekday,mood,')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0].split(',')).toHaveLength(11);
    expect(lines[1].startsWith('"2026-10-23","Friday","Calm","2","Low","no","6","0","",')).toBe(true);
    expect(csv).toContain('"Wrote, with ""quotes""\nand two lines"');
    expect(csv).toContain('"What was one moment I genuinely enjoyed today? Lunch"');
    expect(lines.filter((l) => l.startsWith('"2026-'))).toHaveLength(2);
  });
});
