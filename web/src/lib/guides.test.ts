import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parse, skillDirectories } from './guides';

/**
 * Every committed guide, held to its contract (ADR-0029).
 *
 * Content is data and data has a contract: a guide that stops parsing should fail the build rather
 * than render as a missing row. Each check names the file that broke it.
 */

const ROOT = join(process.cwd(), '..', 'skills');

const guides = skillDirectories().flatMap((packId) => {
  const directory = join(ROOT, packId, 'guides');
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith('.md'))
    .map((name) => ({
      packId,
      slug: name.replace(/\.md$/, ''),
      source: readFileSync(join(directory, name), 'utf8'),
    }));
});

describe('the guide corpus', () => {
  it('names every guide with a slug', () => {
    for (const { packId, slug } of guides) {
      expect(slug, `skills/${packId}/guides/${slug}.md`).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    }
  });

  it('parses every guide against the frontmatter contract', () => {
    for (const { packId, slug, source } of guides) {
      expect(() => parse(packId, slug, source)).not.toThrow();
    }
  });

  it('gives every guide a summary short enough for a list row', () => {
    for (const { packId, slug, source } of guides) {
      const { summary } = parse(packId, slug, source);
      expect(summary.length, `${packId}/${slug}: summary is ${summary.length} chars`).toBeLessThanOrEqual(240);
    }
  });

  it('leaves no guide with an empty body', () => {
    for (const { packId, slug, source } of guides) {
      expect(parse(packId, slug, source).body.length, `${packId}/${slug}`).toBeGreaterThan(200);
    }
  });
});

/**
 * The guard that keeps ADR-0029's condition enforceable.
 *
 * The guides were curated out of a private set of job-search notes, and "impersonal" is the condition
 * on which they are allowed in a public repository at all. That cannot rest on whoever edits a guide
 * next remembering it, so it is a test. The list is generic framing plus the names that have already
 * appeared in this repository's history; it is deliberately not a list of every organisation in the
 * private notes, because publishing that list would be the leak it guards against. A wider sweep
 * runs against the private list before guides are committed.
 *
 * Patterns are matched case-insensitively against the whole file, frontmatter included. Where a word
 * has an innocent sense (a hotel *booking*), the pattern is narrowed to the forms only an employer
 * reference produces.
 */
const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  { pattern: /\bjumbo\b/i, why: 'former employer' },
  { pattern: /\baccenture\b/i, why: 'former employer' },
  { pattern: /\batos\b/i, why: 'former employer' },
  { pattern: /\bquantiphi\b/i, why: 'prospective employer' },
  { pattern: /\bexperis\b/i, why: 'prospective employer' },
  { pattern: /\beurocontrol\b/i, why: 'prospective employer' },
  { pattern: /\bmuac\b/i, why: 'a specific site' },
  { pattern: /\bat Booking\b|\bBooking's\b|\bBooking-(shape|scale|specific|flavou?red)\b/i, why: 'prospective employer' },
  { pattern: /\bcoav\b/i, why: 'a specific programme' },
  { pattern: /\bgurbanov\b/i, why: 'a person' },
  { pattern: /\biryna\b/i, why: 'a person' },
  { pattern: /gap-analysis|upskilling-index\.md|applications\//i, why: 'a private job-search document' },
  { pattern: /\bthe JD\b|\bthis JD\b|\bJD's\b|\bjob description\b/i, why: 'a specific job posting' },
  { pattern: /\bin (the|your) interview\b|\binterview(er)? (will|may) ask\b/i, why: 'interview positioning' },
  { pattern: /legitimately claim|what you can claim|your (own )?(project|engagement|employer)\b/i, why: 'personal framing' },
  { pattern: /Guide owner:/i, why: 'a personal byline' },
];

describe('no guide names a real employer, person, or job posting', () => {
  it('rejects a synthetic guide that names an employer', () => {
    expect(FORBIDDEN.some(({ pattern }) => pattern.test('Notes from my time at Accenture'))).toBe(true);
  });

  for (const { packId, slug, source } of guides) {
    it(`${packId}/${slug}`, () => {
      const hits = FORBIDDEN.filter(({ pattern }) => pattern.test(source)).map(
        ({ pattern, why }) => `${pattern.source} (${why})`,
      );
      expect(hits, `skills/${packId}/guides/${slug}.md must stay impersonal`).toEqual([]);
    });
  }
});
