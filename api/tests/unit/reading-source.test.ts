/**
 * Reading the article directory (ADR-0017).
 *
 * The rules that matter here are the lossy ones: what gets skipped, what gets defaulted, and what
 * two variants of the same article are allowed to disagree about. An import that silently drops a
 * translation is the failure this file exists to catch.
 */

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractTitle, loadReading, splitFrontmatter } from '../../src/importer/reading-source.js';

async function directoryWith(files: Record<string, string>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'reading-'));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(directory, name), content, 'utf8');
  }
  return directory;
}

const article = (title: string, extra = '') =>
  `---\ntitle: ${title}\nlabels: [aws]\nsource:\n  url: https://aws.amazon.com/blogs/architecture/post/\n${extra}---\n\nEen paragraaf met genoeg tekst.\n`;

describe('splitFrontmatter', () => {
  it('separates the yaml block from the markdown', () => {
    const { meta, body } = splitFrontmatter('---\ntitle: Hallo\n---\n\n# Kop\n\nTekst.');
    expect(meta.title).toBe('Hallo');
    expect(body).toBe('# Kop\n\nTekst.');
  });

  it('treats a file with no frontmatter as all body', () => {
    const { meta, body } = splitFrontmatter('# Kop\n\nTekst.');
    expect(meta).toEqual({});
    expect(body).toBe('# Kop\n\nTekst.');
  });
});

describe('extractTitle', () => {
  it('takes the leading heading when the frontmatter names no title', () => {
    const { title, body } = extractTitle('# Multi-region failover\n\nTekst.');
    expect(title).toBe('Multi-region failover');
    // Stripped, because the surface renders the title above the markdown itself.
    expect(body).toBe('Tekst.');
  });

  it('prefers the declared title, and keeps a heading that says something else', () => {
    const { title, body } = extractTitle('# Andere kop\n\nTekst.', 'Multi-region failover');
    expect(title).toBe('Multi-region failover');
    expect(body).toBe('# Andere kop\n\nTekst.');
  });

  it('finds nothing to title an article with neither', () => {
    expect(extractTitle('Gewoon tekst.').title).toBeNull();
  });
});

describe('loadReading', () => {
  it('groups files that share a slug into one article, one variant per language', async () => {
    const directory = await directoryWith({
      'failover.nl.md': article('Multi-region failover'),
      'failover.en.md': article('Multi-region failover'),
    });

    const { articles } = await loadReading({ source: directory });

    expect(articles).toHaveLength(1);
    expect(articles[0]?.slug).toBe('failover');
    expect(articles[0]?.bodies.map((body) => body.language).sort()).toEqual(['en', 'nl']);
  });

  it('skips a file that does not name its language, and says so', async () => {
    const directory = await directoryWith({ 'failover.md': article('Failover') });

    const { articles, warnings } = await loadReading({ source: directory });

    expect(articles).toHaveLength(0);
    expect(warnings[0]).toContain('not named <slug>.<language>.md');
  });

  it('skips an untitled variant rather than importing it under its filename', async () => {
    const directory = await directoryWith({
      'failover.nl.md': article('Failover'),
      'failover.en.md': 'Just a paragraph, no heading and no frontmatter.',
    });

    const { articles, warnings } = await loadReading({ source: directory });

    expect(articles[0]?.bodies).toHaveLength(1);
    expect(warnings.some((warning) => warning.includes('no title'))).toBe(true);
  });

  it('merges labels across the variants of one article', async () => {
    const directory = await directoryWith({
      'failover.nl.md': `---\ntitle: Failover\nlabels: [netwerken]\n---\n\nTekst genoeg.\n`,
      'failover.en.md': `---\ntitle: Failover\nlabels: [aws, netwerken]\n---\n\nEnough text.\n`,
    });

    const { articles } = await loadReading({ source: directory });

    expect(articles[0]?.labels).toEqual(['aws', 'netwerken']);
  });

  it('reports variants that disagree about where the article came from', async () => {
    const directory = await directoryWith({
      'failover.nl.md': article('Failover'),
      'failover.en.md': `---\ntitle: Failover\nsource:\n  url: https://example.com/other\n---\n\nEnough text.\n`,
    });

    const { warnings } = await loadReading({ source: directory });

    expect(warnings.some((warning) => warning.includes('different source url'))).toBe(true);
  });

  it('loads one article when asked for one', async () => {
    const directory = await directoryWith({
      'failover.nl.md': article('Failover'),
      'graviton.nl.md': article('Graviton'),
    });

    const { articles } = await loadReading({ source: directory, only: 'graviton' });

    expect(articles.map((entry) => entry.slug)).toEqual(['graviton']);
  });
});
