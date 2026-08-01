/**
 * The importer: heading → section kind, markdown → typed sections, CSV → drill items.
 *
 * All fixtures are invented (ADR-0006). They reproduce the *shapes* the source format uses —
 * including the ones that previously mis-parsed.
 */

import { describe, expect, it } from 'vitest';
import { column, parseCsv, splitLine, splitParts } from '../../src/importer/csv.js';
import {
  DEFAULT_SECTION_MAP,
  parseLesson,
  parseListItems,
  parseTable,
  resolveKind,
} from '../../src/importer/markdown.js';
import { mapToDeclared, parseErrorLog, resolveCategory, toEntries } from '../../src/importer/error-log-source.js';

describe('CSV parsing', () => {
  it('honours quoted fields containing commas', () => {
    expect(splitLine('a,"b, still b",c')).toEqual(['a', 'b, still b', 'c']);
  });

  it('honours an escaped quote inside a quoted field', () => {
    expect(splitLine('a,"say ""hi""",c')).toEqual(['a', 'say "hi"', 'c']);
  });

  it('reads by header name, so column order does not matter', () => {
    const { rows } = parseCsv('English,Nederlands\ncomplicated,ingewikkeld');
    expect(column(rows[0] as Record<string, string>, ['Nederlands'])).toBe('ingewikkeld');
  });

  it('accepts any of several column aliases', () => {
    const { rows } = parseCsv('Term,Translation\nwoord,word');
    expect(column(rows[0] as Record<string, string>, ['Nederlands', 'Term'])).toBe('woord');
  });

  it('treats an absent optional column as absent rather than empty string', () => {
    const { rows } = parseCsv('Nederlands,English\nwoord,word');
    expect(column(rows[0] as Record<string, string>, ['Les'])).toBeUndefined();
  });

  it('keeps a newline inside a quoted field from ending the row', () => {
    const { rows } = parseCsv('A,B\n"line one\nline two",second');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.A).toContain('line two');
  });

  it('splits chunk lists on the pipe separator', () => {
    expect(splitParts('ik | begin | morgen')).toEqual(['ik', 'begin', 'morgen']);
  });
});

describe('heading → section kind', () => {
  const resolve = (heading: string) => resolveKind(heading, DEFAULT_SECTION_MAP);

  it('maps the plain cases', () => {
    expect(resolve('Tekst (lees hardop)')).toBe('text');
    expect(resolve('Woordenschat')).toBe('vocabulary');
    expect(resolve('Schrijf (stuur naar mij)')).toBe('write');
    expect(resolve('Luisteropdracht')).toBe('listening');
    expect(resolve('Oefening A — zet in de perfectum')).toBe('exercise');
  });

  it('names a heading for what it leads with, not for a keyword buried later', () => {
    // Previously mis-mapped to `questions`, because "vragen" appears in the heading.
    expect(resolve('Tekst (lees hardop) — vragen stellen & afronden')).toBe('text');
  });

  it('prefers the longer term when both start at the same place', () => {
    expect(resolve('Begripsvragen')).toBe('questions');
    expect(resolve('Woordenschat (opwarmtekst)')).toBe('vocabulary');
  });

  it('does not read "Bespreek" as "spreek"', () => {
    expect(resolve('Bespreek met mij')).toBe('questions');
    expect(resolve('Spreek hardop — drill')).toBe('speak');
  });

  it('returns null for a heading it does not recognise', () => {
    expect(resolve('Waarom dit werkt (kort)')).toBeNull();
  });
});

describe('markdown fragments', () => {
  it('parses a table, dropping the separator row', () => {
    const rows = parseTable('| A | B |\n|---|---|\n| one | two |');
    expect(rows).toEqual([
      ['A', 'B'],
      ['one', 'two'],
    ]);
  });

  it('parses numbered and bulleted lists, stripping the markers', () => {
    expect(parseListItems('1. First\n2. Second')).toEqual([
      { ref: '1', text: 'First' },
      { ref: '2', text: 'Second' },
    ]);
    expect(parseListItems('- alpha\n- beta').map((item) => item.text)).toEqual(['alpha', 'beta']);
  });
});

describe('parseLesson', () => {
  const lesson = `# Les 3 · Een voorbeeldles

**Niveau:** B1.2 · **Tijd:** ~25 min · **Loop:** lezen → schrijven

## 1. Tekst (lees hardop)

> Dit is de tekst.
> Nog een regel.

## 2. Woordenschat

| Nederlands | English | Voorbeeld |
|---|---|---|
| tevreden | satisfied | Ik was tevreden. |
| het overleg | the meeting | Het overleg duurde lang. |

## 3. Begripsvragen

Beantwoord eerst hardop.

1. Waarom is dit zo?
2. Wat vind jij ervan?

## 4. Oefening — zet om

Schrijf elke zin om.

1. Ik werk thuis.
2. Hij fietst weg.

### Antwoorden

1. Ik heb thuisgewerkt.
2. Hij is weggefietst.

## 5. Schrijf

Schrijf zes zinnen over gisteren.

- gebruik de voltooide tijd
- gebruik één bijzin

## 6. Waarom dit werkt

Een korte toelichting zonder lijst of tabel.
`;

  const parsed = parseLesson(lesson);

  it('takes the title from the H1 and drops the lesson number', () => {
    expect(parsed.title).toBe('Een voorbeeldles');
  });

  it('reads level and duration from the metadata line', () => {
    expect(parsed.level).toBe('B1.2');
    expect(parsed.estimatedMinutes).toBe(25);
  });

  it('unwraps a blockquoted reading passage into prose', () => {
    const text = parsed.sections.find((section) => section.kind === 'text');
    expect(text).toMatchObject({ id: 'tekst-lees-hardop' });
    expect((text as { body: string }).body).toBe('Dit is de tekst.\nNog een regel.');
  });

  it('turns a vocabulary table into entries, skipping its header', () => {
    const vocabulary = parsed.sections.find((section) => section.kind === 'vocabulary');
    expect((vocabulary as { items: unknown[] }).items).toEqual([
      { term: 'tevreden', translation: 'satisfied', example: 'Ik was tevreden.' },
      { term: 'het overleg', translation: 'the meeting', example: 'Het overleg duurde lang.' },
    ]);
  });

  it('keeps the prose above a list as the section instruction', () => {
    const questions = parsed.sections.find((section) => section.kind === 'questions');
    expect(questions).toMatchObject({ instruction: 'Beantwoord eerst hardop.' });
    expect((questions as { items: unknown[] }).items).toHaveLength(2);
  });

  it('separates an exercise answer key from its items', () => {
    const exercise = parsed.sections.find((section) => section.kind === 'exercise') as {
      items: { ref: string }[];
      answers?: { ref: string; answer: string }[];
    };
    expect(exercise.items).toHaveLength(2);
    expect(exercise.answers).toEqual([
      { ref: '1', answer: 'Ik heb thuisgewerkt.' },
      { ref: '2', answer: 'Hij is weggefietst.' },
    ]);
  });

  it('reads a write task’s bullets as its requirements', () => {
    const write = parsed.sections.find((section) => section.kind === 'write');
    expect(write).toMatchObject({ prompt: 'Schrijf zes zinnen over gisteren.' });
    expect((write as { requirements: string[] }).requirements).toEqual([
      'gebruik de voltooide tijd',
      'gebruik één bijzin',
    ]);
  });

  it('keeps an unrecognised heading as text rather than dropping the content, and says so', () => {
    const kept = parsed.sections.find((section) => section.title === 'Waarom dit werkt');
    expect(kept?.kind).toBe('text');
    expect(parsed.warnings.some((warning) => warning.includes('Waarom dit werkt'))).toBe(true);
  });

  it('gives every section a distinct id, since submissions reference them', () => {
    const ids = parsed.sections.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('degrades a mapped-but-empty section to text instead of failing the import', () => {
    const degraded = parseLesson('# Les 1 · X\n\n## 1. Zelftest woordenschat\n\nDek de kolom af en zeg het hardop.\n');
    expect(degraded.sections[0]).toMatchObject({ kind: 'text' });
    expect(degraded.warnings[0]).toContain('no usable content');
  });
});

describe('error-log backfill', () => {
  const table = `
| Categorie | Voorbeeldfout | Correct | Eerst gezien | Laatst gezien | Keer | Status |
|---|---|---|---|---|---|---|
| spelling | schrijffout | schrijffout | 2026-06-15 | 2026-07-04 | 5 | 🔁 |
| lidwoord | de huis | het huis | 2026-06-16 | 2026-06-16 | 1 | 🆕 |
`;

  const rows = parseErrorLog(table, new Date('2026-08-01T00:00:00Z'));

  it('reads a category, its example and its count', () => {
    expect(rows[0]).toMatchObject({ category: 'spelling', wrong: 'schrijffout', count: 5 });
  });

  it('parses the first and last seen dates', () => {
    expect(rows[0]?.firstSeen.toISOString()).toBe('2026-06-15T00:00:00.000Z');
    expect(rows[0]?.lastSeen.toISOString()).toBe('2026-07-04T00:00:00.000Z');
  });

  it('skips the header row', () => {
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.category)).toEqual(['spelling', 'lidwoord']);
  });

  it('derives status from the count, exactly as the loop would', () => {
    const entries = toEntries(rows, 'learner-1', 'pack-1');
    expect(entries[0]).toMatchObject({ category: 'spelling', count: 5, status: 'recurring' });
    expect(entries[1]).toMatchObject({ category: 'lidwoord', count: 1, status: 'new' });
  });

  it('starts every backfilled entry with no clean blocks, so mastery must be earned here', () => {
    for (const entry of toEntries(rows, 'learner-1', 'pack-1')) {
      expect(entry).toMatchObject({ cleanBlocks: 0, closedThrough: 0, lastBlockOrder: 0 });
    }
  });
});

describe('backfill category matching', () => {
  // Exactly the shapes a hand-maintained table produces against a slug-cased manifest.
  const declared = ['lidwoord', 'congruentie', 'scheidbaar-werkwoord', 'perfectum-imperfectum', 'passief', 'spelling'];

  it('matches an id written verbatim', () => {
    expect(resolveCategory('spelling', declared)).toBe('spelling');
  });

  it('matches a heading that only differs in punctuation and spacing', () => {
    expect(resolveCategory('scheidbaar werkwoord', declared)).toBe('scheidbaar-werkwoord');
    expect(resolveCategory('perfectum/imperfectum', declared)).toBe('perfectum-imperfectum');
  });

  it('treats a trailing parenthetical as decoration', () => {
    expect(resolveCategory('lidwoord (de/het)', declared)).toBe('lidwoord');
    expect(resolveCategory('passief (worden/zijn)', declared)).toBe('passief');
  });

  it('also tries the parenthetical as the name itself', () => {
    expect(resolveCategory('onderwerp-werkwoord (congruentie)', declared)).toBe('congruentie');
  });

  it('returns null rather than guessing at something undeclared', () => {
    expect(resolveCategory('uitspraak', declared)).toBeNull();
  });

  it('reports unresolved headings instead of writing them — they would never join anything', () => {
    const rows = parseErrorLog(
      '| Categorie | A | B | C | D | Keer |\n|---|---|---|---|---|---|\n| spelling | x | y | | | 2 |\n| iets onbekends | x | y | | | 9 |',
      new Date('2026-08-01T00:00:00Z'),
    );
    const { rows: mapped, unresolved } = mapToDeclared(rows, declared);
    expect(mapped.map((row) => row.category)).toEqual(['spelling']);
    expect(unresolved).toEqual([{ raw: 'iets onbekends', count: 9 }]);
  });
});
