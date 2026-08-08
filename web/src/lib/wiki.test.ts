import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parse } from './wiki';
import { isFormat, isTopic } from './wiki-labels';

/**
 * The corpus, held to its contract.
 *
 * This is the wiki's answer to `api/src/importer/validate-manifests.ts`: content is data, data has a
 * contract, and a violation should fail the build rather than render as a missing tile. Every check
 * here names the file that broke it, because a corpus-wide assertion that only says "false" is a
 * search problem, not a test result.
 */

const DIRECTORY = join(process.cwd(), 'content', 'wiki');

const files = readdirSync(DIRECTORY).filter((name) => name.endsWith('.md'));
const guides = files.map((name) => {
  const slug = name.replace(/\.md$/, '');
  return { slug, source: readFileSync(join(DIRECTORY, name), 'utf8') };
});

describe('the wiki corpus', () => {
  it('is not empty', () => {
    // Cheap, and the only check that catches a corpus which failed to arrive at all — most likely
    // a `.gitignore` regression, since ADR-0006's `content/` rule matches at any depth and would
    // exclude every guide. Every other assertion here passes happily on zero files, which is
    // exactly how an empty library reaches production unnoticed.
    expect(files.length).toBeGreaterThan(0);
  });

  it('parses every guide against the frontmatter contract', () => {
    for (const { slug, source } of guides) {
      expect(() => parse(slug, source)).not.toThrow();
    }
  });

  it('gives every guide a known topic and format', () => {
    for (const { slug, source } of guides) {
      const guide = parse(slug, source);
      expect(isTopic(guide.topic), `${slug}: topic`).toBe(true);
      expect(isFormat(guide.format), `${slug}: format`).toBe(true);
    }
  });

  it('gives every guide a summary short enough for a tile', () => {
    for (const { slug, source } of guides) {
      const { summary } = parse(slug, source);
      expect(summary.length, `${slug}: summary is ${summary.length} chars`).toBeLessThanOrEqual(200);
    }
  });

  it('leaves no guide with an empty body', () => {
    for (const { slug, source } of guides) {
      expect(parse(slug, source).body.length, slug).toBeGreaterThan(200);
    }
  });
});

/**
 * The guard that makes ADR-0016's promise enforceable.
 *
 * The library was sanitised out of a private set of job-search notes, and "keep it generic" is the
 * condition on which it is allowed in a public repository at all. That condition cannot rest on
 * whoever edits a guide next remembering it — so it is a test.
 *
 * Patterns are matched case-insensitively against the whole file, frontmatter included. Where a word
 * has an innocent sense (a hotel *booking*, a *contrail* as atmospheric physics), the pattern is
 * narrowed to the possessive and compound forms that only an employer reference produces.
 */
const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  { pattern: /\bjumbo\b/i, why: 'former employer' },
  { pattern: /\baccenture\b/i, why: 'former employer' },
  { pattern: /\batos\b/i, why: 'former employer' },
  { pattern: /\bquantiphi\b/i, why: 'prospective employer' },
  { pattern: /\bexperis\b/i, why: 'prospective employer' },
  { pattern: /\beurocontrol\b/i, why: 'prospective employer' },
  { pattern: /\bmuac\b/i, why: 'a specific site' },
  // "a booking" is an ordinary noun; "Booking's" / "Booking-shape" / "at Booking" is a company.
  { pattern: /\bat Booking\b|\bBooking's\b|\bBooking-(shape|scale|specific|flavou?red)\b/i, why: 'prospective employer' },
  { pattern: /\bcoav\b/i, why: 'a specific programme' },
  { pattern: /\bgurbanov\b/i, why: 'a person' },
  { pattern: /\biryna\b/i, why: 'a person' },
  { pattern: /gap-analysis|upskilling-index\.md/i, why: 'a private job-search document' },
  { pattern: /\bthe JD\b|\bthis JD\b|\bJD's\b/i, why: 'a specific job description' },
  { pattern: /legitimately claim|what you can claim/i, why: 'personal-positioning framing' },
  { pattern: /Guide owner:/i, why: 'a personal byline' },
];

describe('no guide names a real employer, person, or job posting', () => {
  for (const { slug, source } of guides) {
    it(slug, () => {
      const hits = FORBIDDEN.filter(({ pattern }) => pattern.test(source)).map(
        ({ pattern, why }) => `${pattern.source} (${why})`,
      );
      expect(hits, `content/wiki/${slug}.md must stay generic`).toEqual([]);
    });
  }
});
