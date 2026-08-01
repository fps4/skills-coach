/**
 * Turning an authored markdown lesson into typed sections (ADR-0004).
 *
 * The source lessons are consistently shaped — an H1, a metadata line, then numbered `##` sections
 * whose headings name what they are ("Tekst", "Woordenschat", "Spreek hardop", "Schrijf"). The
 * mapping from heading to section kind is *pack configuration*, not code, so the importer is not
 * tied to Dutch.
 *
 * Robustness rule: when a heading maps to a kind but the content cannot produce it — a "Zelftest
 * woordenschat" heading with no table, say — the section degrades to `text` rather than failing the
 * import. Losing a lesson's structure is recoverable; losing the lesson is not.
 */

import type { PromptItem, Section, SectionKind, SectionMapEntry } from '../domain/types.js';

/**
 * Heading keywords, in precedence order.
 *
 * A heading often contains more than one keyword — "Tekst (lees hardop) — vragen stellen" holds
 * both *tekst* and *vragen*, and "Bespreek met mij" contains *spreek*. Matching is therefore by
 * **earliest occurrence in the heading**, with this list's order breaking ties: a heading is named
 * for what it leads with. Map order alone would make that first example a questions section.
 */
export const DEFAULT_SECTION_MAP: SectionMapEntry[] = [
  { match: 'woordenschat', kind: 'vocabulary' },
  { match: 'vocabulary', kind: 'vocabulary' },
  { match: 'bespreek', kind: 'questions' },
  { match: 'begripsvragen', kind: 'questions' },
  { match: 'vragen', kind: 'questions' },
  { match: 'questions', kind: 'questions' },
  { match: 'dictee', kind: 'dictation' },
  { match: 'dictation', kind: 'dictation' },
  { match: 'luister', kind: 'listening' },
  { match: 'listening', kind: 'listening' },
  { match: 'oefening', kind: 'exercise' },
  { match: 'exercise', kind: 'exercise' },
  { match: 'puzzel', kind: 'exercise' },
  { match: 'puzzle', kind: 'exercise' },
  { match: 'regels', kind: 'rules' },
  { match: 'grammatica', kind: 'rules' },
  { match: 'rules', kind: 'rules' },
  { match: 'spreek', kind: 'speak' },
  { match: 'speak', kind: 'speak' },
  { match: 'schrijf', kind: 'write' },
  { match: 'write', kind: 'write' },
  { match: 'tekst', kind: 'text' },
  { match: 'text', kind: 'text' },
  { match: 'artikel', kind: 'text' },
  { match: 'article', kind: 'text' },
];

export interface ParsedLesson {
  title: string;
  level?: string;
  estimatedMinutes?: number;
  focus?: string;
  sections: Section[];
  /** Headings that produced nothing usable — reported so an import is never silently lossy. */
  warnings: string[];
}

interface RawSection {
  heading: string;
  body: string;
}

/** Strip a leading "3." or "3 ·" from a heading, and any trailing emoji decoration. */
function cleanHeading(heading: string): string {
  return (
    heading
      .replace(/^#+\s*/, '')
      .replace(/^\d+[.)]\s*/, '')
      // Unicode property escapes rather than a hand-rolled range: the variation selector and the
      // pictographs are separate concerns, and combining them in one class is ambiguous.
      .replace(/\p{Extended_Pictographic}/gu, '')
      .replace(/\uFE0F/g, '')
      .trim()
  );
}

function slugify(text: string, fallback: string): string {
  const slug = text
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || fallback;
}

/** Split the document on `##` headings. Anything before the first one is the preamble. */
function splitSections(markdown: string): { preamble: string; sections: RawSection[] } {
  const lines = markdown.split(/\r?\n/);
  const sections: RawSection[] = [];
  const preamble: string[] = [];
  let current: RawSection | null = null;
  let inFence = false;

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) inFence = !inFence;

    if (!inFence && /^##\s+/.test(line)) {
      if (current) sections.push(current);
      current = { heading: line, body: '' };
      continue;
    }
    if (current) current.body += `${line}\n`;
    else preamble.push(line);
  }
  if (current) sections.push(current);

  return { preamble: preamble.join('\n'), sections };
}

/** Remove blockquote markers so a read-aloud passage becomes plain prose. */
function unquote(body: string): string {
  return body
    .split('\n')
    .map((line) => line.replace(/^>\s?/, ''))
    .join('\n')
    .trim();
}

/** Drop headings, tables, list markup and horizontal rules — what is left is prose. */
function prose(body: string): string {
  return unquote(body)
    .split('\n')
    .filter((line) => !/^\s*\|/.test(line) && !/^#{3,}\s/.test(line) && !/^\s*---+\s*$/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Parse a GitHub-flavoured table into rows of trimmed cells. */
export function parseTable(body: string): string[][] {
  const rows: string[][] = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    // The `|---|---|` separator row carries no data.
    if (/^\|[\s:|-]+\|$/.test(trimmed)) continue;
    rows.push(
      trimmed
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((cell) => cell.trim()),
    );
  }
  return rows;
}

/** Numbered or bulleted list items, with their numbering stripped. */
export function parseListItems(body: string): { ref: string; text: string }[] {
  const items: { ref: string; text: string }[] = [];
  for (const line of unquote(body).split('\n')) {
    const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (numbered) {
      items.push({ ref: numbered[1] as string, text: (numbered[2] as string).trim() });
      continue;
    }
    const bulleted = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bulleted) {
      items.push({ ref: String(items.length + 1), text: (bulleted[1] as string).trim() });
    }
  }
  return items.filter((item) => item.text.length > 0);
}

/** Everything under a `### Antwoorden`-style subheading — the answer key. */
function splitAnswerKey(body: string): { main: string; answers: string } {
  const match = body.match(/^###\s+.*$/m);
  if (!match || match.index === undefined) return { main: body, answers: '' };
  return { main: body.slice(0, match.index), answers: body.slice(match.index) };
}

/**
 * Pick the keyword that appears earliest in the heading; the map's own order breaks ties.
 * See the note on `DEFAULT_SECTION_MAP` for why position beats precedence.
 */
export function resolveKind(heading: string, map: SectionMapEntry[]): SectionKind | null {
  const lowered = heading.toLocaleLowerCase();
  let best: { kind: SectionKind; at: number; rank: number } | null = null;

  for (const [rank, entry] of map.entries()) {
    const at = lowered.indexOf(entry.match.toLocaleLowerCase());
    if (at < 0) continue;
    if (!best || at < best.at || (at === best.at && rank < best.rank)) {
      best = { kind: entry.kind, at, rank };
    }
  }
  return best?.kind ?? null;
}

/**
 * Build one section. Returns null when the heading's kind cannot be satisfied by the content, so
 * the caller can fall back to prose.
 */
function buildSection(kind: SectionKind, id: string, title: string, body: string): Section | null {
  switch (kind) {
    case 'text':
    case 'rules': {
      const content = prose(body);
      return content ? { id, kind, title, body: content } : null;
    }

    case 'vocabulary': {
      const rows = parseTable(body);
      // Drop the header row when it is one — a real entry never has "English" as its translation.
      const dataRows = rows.filter((row) => row.length >= 2 && !/^(nederlands|term|woord)$/i.test(row[0] as string));
      const items = dataRows
        .map((row) => ({ term: row[0] as string, translation: row[1] ?? '', example: row[2] || undefined }))
        .filter((item) => item.term.length > 0 && item.translation.length > 0);
      return items.length > 0 ? { id, kind: 'vocabulary', title, items } : null;
    }

    case 'questions': {
      const items: PromptItem[] = parseListItems(body).map((item) => ({ ref: item.ref, prompt: item.text }));
      return items.length > 0 ? { id, kind: 'questions', title, items, instruction: leadIn(body) } : null;
    }

    case 'dictation': {
      const sentences = parseListItems(body).map((item) => item.text);
      return sentences.length > 0 ? { id, kind: 'dictation', title, prompt: leadIn(body), sentences } : null;
    }

    case 'exercise': {
      const { main, answers } = splitAnswerKey(body);
      const items: PromptItem[] = parseListItems(main).map((item) => ({ ref: item.ref, prompt: item.text }));
      if (items.length === 0) return null;
      const answerItems = parseListItems(answers).map((item) => ({ ref: item.ref, answer: item.text }));
      return {
        id,
        kind: 'exercise',
        title,
        prompt: leadIn(main),
        items,
        answers: answerItems.length > 0 ? answerItems : undefined,
      };
    }

    case 'speak':
    case 'write': {
      const prompt = leadIn(body) || prose(body);
      if (!prompt) return null;
      const requirements = parseListItems(body).map((item) => item.text);
      return { id, kind, title, prompt, requirements: requirements.length > 0 ? requirements : undefined };
    }

    case 'listening': {
      const prompt = leadIn(body) || prose(body);
      if (!prompt) return null;
      const sources = parseListItems(body).map((item) => ({ title: item.text }));
      return { id, kind: 'listening', title, prompt, sources: sources.length > 0 ? sources : undefined };
    }

    default:
      return null;
  }
}

/** The prose above any list or table — the instruction that introduces a section. */
function leadIn(body: string): string {
  const lines: string[] = [];
  for (const line of unquote(body).split('\n')) {
    if (/^\s*(\d+[.)]|[-*+])\s+/.test(line) || /^\s*\|/.test(line) || /^#{3,}\s/.test(line)) break;
    lines.push(line);
  }
  return lines.join('\n').trim();
}

/** `**Niveau:** B1.1 · **Tijd:** ~20 min` and equivalents. */
function parseMetadata(preamble: string): { level?: string; minutes?: number; focus?: string } {
  const level = preamble.match(/\*\*(?:niveau|level)\s*:?\*\*\s*([^\s·|]+)/i)?.[1];
  const minutes = preamble.match(/\*\*(?:tijd|time)\s*:?\*\*\s*~?\s*(\d+)/i)?.[1];
  const focus = preamble.match(/\*\*(?:loop|focus)\s*:?\*\*\s*([^·|\n]+)/i)?.[1];
  return {
    level: level?.replace(/[.,;]$/, ''),
    minutes: minutes ? Number(minutes) : undefined,
    focus: focus?.trim(),
  };
}

export function parseLesson(markdown: string, sectionMap: SectionMapEntry[] = DEFAULT_SECTION_MAP): ParsedLesson {
  const { preamble, sections: raw } = splitSections(markdown);

  const heading = preamble.match(/^#\s+(.*)$/m)?.[1]?.trim() ?? 'Untitled lesson';
  // "Les 1 · Voorstellen & je achtergrond" reads better as its subject alone.
  const title = heading.replace(/^les(son)?\s*\d+\s*[·:—-]\s*/i, '').trim() || heading;
  const { level, minutes, focus } = parseMetadata(preamble);

  const sections: Section[] = [];
  const warnings: string[] = [];
  const usedIds = new Set<string>();

  for (const [index, entry] of raw.entries()) {
    const clean = cleanHeading(entry.heading);
    let id = slugify(clean, `sectie-${index + 1}`);
    while (usedIds.has(id)) id = `${id}-${index + 1}`;
    usedIds.add(id);

    const kind = resolveKind(clean, sectionMap);
    const built = kind ? buildSection(kind, id, clean, entry.body) : null;

    if (built) {
      sections.push(built);
      continue;
    }

    // Unmapped, or mapped but unsatisfiable — keep the prose rather than drop the content.
    const content = prose(entry.body);
    if (content) {
      sections.push({ id, kind: 'text', title: clean, body: content });
      warnings.push(
        kind
          ? `"${clean}" mapped to ${kind} but had no usable content — kept as text`
          : `"${clean}" is unmapped — kept as text`,
      );
    } else {
      warnings.push(`"${clean}" produced nothing and was skipped`);
    }
  }

  return { title, level, estimatedMinutes: minutes, focus, sections, warnings };
}

/** Block metadata from its README: the H1 title, plus whatever the metadata line offers. */
export function parseBlockReadme(markdown: string): {
  title: string;
  level?: string;
  theme?: string;
  milestone?: string;
} {
  const title = markdown.match(/^#\s+(.*)$/m)?.[1]?.trim() ?? '';
  const { level } = parseMetadata(markdown);
  const theme = markdown.match(/^##\s*(?:thema|theme)[^\n]*\n+([^\n#]+)/im)?.[1]?.trim();
  const milestone = markdown.match(/^##\s*(?:mijlpaal|milestone)[^\n]*\n+([^\n#]+)/im)?.[1]?.trim();
  return { title, level, theme, milestone };
}
