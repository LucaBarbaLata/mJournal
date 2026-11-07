/**
 * Exports for reading or moving the journal elsewhere: structured JSON with
 * everything, and a CSV with one row per day for spreadsheets. Photos are
 * listed by file name; a full backup is the way to keep the photo files.
 */
import { weekdayName } from '@core/dates';
import { energyLabel } from '@core/moods';
import { MONTHLY_INTENTION_KEY, MONTHLY_QUESTIONS, MONTHLY_LETTER_KEY, YEARLY_LETTER_KEY, YEARLY_QUESTIONS } from '@core/prompts';
import type { Journal } from '../journal';

export const EXPORT_KIND = 'mjournal-export';
export const EXPORT_VERSION = 1;

interface ExportEntryRow {
  date: string;
  body: string;
  mood: string | null;
  mood_note: string;
  energy: number | null;
  favorite: number;
  word_count: number;
  created_at: string;
  updated_at: string;
}

export function buildJsonExport(journal: Journal, appVersion: string) {
  const moods = journal.moods.list();
  const moodLabel = new Map(moods.map((m) => [m.key, m.label]));
  const rows = journal.db.all<ExportEntryRow>('SELECT * FROM entries WHERE has_content ORDER BY date');
  const answers = journal.db.all<{ entry_date: string; prompt_id: string; prompt_text: string; answer: string; favorite: number }>(
    "SELECT entry_date, prompt_id, prompt_text, answer, favorite FROM answers WHERE answer <> '' ORDER BY entry_date, position, id",
  );
  const photos = journal.db.all<{
    entry_date: string;
    file: string;
    original_name: string;
    caption: string;
    favorite: number;
    width: number | null;
    height: number | null;
  }>(
    'SELECT entry_date, file, original_name, caption, favorite, width, height FROM photos WHERE removed_at IS NULL ORDER BY entry_date, position',
  );
  const group = <T extends { entry_date: string }>(items: T[]) => {
    const map = new Map<string, T[]>();
    for (const item of items) map.set(item.entry_date, [...(map.get(item.entry_date) ?? []), item]);
    return map;
  };
  const answersByDay = group(answers);
  const photosByDay = group(photos);
  const tagsByDay = group(
    journal.db.all<{ entry_date: string; label: string; picked: number; written: number }>(
      `SELECT et.entry_date, t.label, et.picked, et.written FROM entry_tags et JOIN tags t ON t.name = et.tag
       ORDER BY et.entry_date, t.label COLLATE NOCASE`,
    ),
  );

  const reflections = journal.db.all<{ month: string; question: string; answer: string; updated_at: string }>(
    "SELECT month, question, answer, updated_at FROM monthly_reflections WHERE answer <> '' ORDER BY month",
  );
  const questionText = new Map<string, string>(MONTHLY_QUESTIONS.map((q) => [q.key, q.text]));
  questionText.set(MONTHLY_LETTER_KEY, 'Letter to myself');
  questionText.set(MONTHLY_INTENTION_KEY, 'My intention for the month');
  const months = new Map<string, { month: string; answers: { key: string; question: string; answer: string }[]; updatedAt: string }>();
  for (const r of reflections) {
    const month = months.get(r.month) ?? { month: r.month, answers: [], updatedAt: r.updated_at };
    month.answers.push({ key: r.question, question: questionText.get(r.question) ?? r.question, answer: r.answer });
    if (r.updated_at > month.updatedAt) month.updatedAt = r.updated_at;
    months.set(r.month, month);
  }

  return {
    app: 'mJournal',
    kind: EXPORT_KIND,
    exportVersion: EXPORT_VERSION,
    appVersion,
    exportedAt: journal.clock().toISOString(),
    note: 'Photos are listed by their file name inside the mJournal data folder. Use a full backup to keep the photo files.',
    entries: rows.map((row) => ({
      date: row.date,
      mood: row.mood,
      moodLabel: row.mood ? (moodLabel.get(row.mood) ?? row.mood) : null,
      moodNote: row.mood_note,
      energy: row.energy,
      energyLabel: energyLabel(row.energy),
      favorite: row.favorite === 1,
      body: row.body,
      wordCount: row.word_count,
      answers: (answersByDay.get(row.date) ?? []).map((a) => ({
        promptId: a.prompt_id,
        question: a.prompt_text,
        answer: a.answer,
        favorite: a.favorite === 1,
      })),
      tags: (tagsByDay.get(row.date) ?? []).map((t) => t.label),
      photos: (photosByDay.get(row.date) ?? []).map((p) => ({
        file: `photos/${p.file}`,
        originalName: p.original_name,
        caption: p.caption,
        favorite: p.favorite === 1,
        width: p.width,
        height: p.height,
      })),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    monthlyReflections: [...months.values()],
    yearlyReflections: (() => {
      const yearText = new Map<string, string>(YEARLY_QUESTIONS.map((q) => [q.key, q.text]));
      yearText.set(YEARLY_LETTER_KEY, 'Letter to myself');
      const years = new Map<number, { year: number; answers: { key: string; question: string; answer: string }[]; updatedAt: string }>();
      for (const r of journal.db.all<{ year: number; question: string; answer: string; updated_at: string }>(
        "SELECT year, question, answer, updated_at FROM yearly_reflections WHERE answer <> '' ORDER BY year",
      )) {
        const year = years.get(r.year) ?? { year: r.year, answers: [], updatedAt: r.updated_at };
        year.answers.push({ key: r.question, question: yearText.get(r.question) ?? r.question, answer: r.answer });
        if (r.updated_at > year.updatedAt) year.updatedAt = r.updated_at;
        years.set(r.year, year);
      }
      return [...years.values()];
    })(),
    lettersToTheFuture: journal.db
      .all<{ open_on: string; written_on: string; body: string; opened_at: string | null }>(
        "SELECT open_on, written_on, body, opened_at FROM capsules WHERE body <> '' ORDER BY open_on, id",
      )
      .map((c) => ({ opensOn: c.open_on, writtenOn: c.written_on, letter: c.body, openedAt: c.opened_at })),
    tags: journal.tags.list().map((t) => ({ label: t.label, quickChip: t.quick, days: t.days })),
    moods: moods.map((m) => ({ key: m.key, label: m.label, icon: m.icon, color: m.color, hidden: m.hidden, builtIn: m.builtIn })),
    customPrompts: journal.prompts
      .library()
      .filter((p) => p.custom)
      .map((p) => ({ id: p.id, text: p.text, inRotation: p.inRotation, favorite: p.favorite })),
    favoritePrompts: journal.prompts
      .library()
      .filter((p) => p.favorite)
      .map((p) => ({ id: p.id, text: p.text })),
    settings: journal.settings.get(),
  };
}

/** Quotes a CSV cell. Cells that a spreadsheet would run as a formula get a leading apostrophe. */
export function csvCell(value: string | number | boolean | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+@\t\r]/.test(text) || /^-(?! )/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export const CSV_COLUMNS = [
  'date',
  'weekday',
  'mood',
  'energy',
  'energy_label',
  'favorite',
  'word_count',
  'photo_count',
  'mood_note',
  'writing',
  'prompt_answers',
  'tags',
] as const;

export function buildCsv(journal: Journal): string {
  const data = buildJsonExport(journal, '');
  const lines = [CSV_COLUMNS.join(',')];
  for (const entry of data.entries) {
    lines.push(
      [
        entry.date,
        weekdayName(entry.date),
        entry.moodLabel ?? '',
        entry.energy ?? '',
        entry.energyLabel ?? '',
        entry.favorite ? 'yes' : 'no',
        entry.wordCount,
        entry.photos.length,
        entry.moodNote,
        entry.body,
        entry.answers.map((a) => `${a.question} ${a.answer}`).join('\n\n'),
        entry.tags.join(', '),
      ]
        .map(csvCell)
        .join(','),
    );
  }
  // A byte-order mark and CRLF line endings make Excel read UTF-8 text correctly.
  return `﻿${lines.join('\r\n')}\r\n`;
}
