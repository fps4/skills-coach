/**
 * Reading a library of articles from a directory on disk (ADR-0017).
 *
 * The layout is one file per article *per language*, named for both:
 *
 *   articles/
 *     multi-region-failover.nl.md
 *     multi-region-failover.en.md
 *     graviton-migratie.nl.md
 *
 * Files sharing a slug are the same article, and the tag after it is the language that variant is
 * written in. That convention is doing real work: an article is a parallel text, and a layout where
 * the two languages are separate files is one an agent can write, a person can proofread, and a
 * diff can show — which a single file holding both would not be.
 *
 * Each file is YAML frontmatter and then markdown. The markdown is never parsed here: the runtime
 * carries it and the viewer renders it, so anything the surface understands can be written without
 * touching this.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { articleSchema, type ArticleInput } from '../domain/schemas.js';

/** `slug.lang.md` — the slug may hold dashes, the language tag may hold one region subtag. */
const ARTICLE_FILE = /^([a-z0-9][a-z0-9-]*)\.([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)\.md$/;

interface Frontmatter {
  title?: string;
  summary?: string;
  labels?: string[];
  source?: { url?: string; site?: string; author?: string; publishedAt?: string };
  estimatedMinutes?: number;
}

interface VariantFile {
  slug: string;
  language: string;
  file: string;
  meta: Frontmatter;
  body: string;
}

export interface LoadedReading {
  articles: ArticleInput[];
  /** Anything dropped, defaulted or disagreed about. An import that loses material says so. */
  warnings: string[];
}

/**
 * Split YAML frontmatter from the markdown after it.
 *
 * A file with no frontmatter is not an error — its title comes from the first `#` heading, which is
 * how most markdown in the wild already carries one.
 */
export function splitFrontmatter(raw: string): { meta: Frontmatter; body: string } {
  // A byte-order mark ahead of the `---` would stop the frontmatter matching at all, and a file
  // saved by a Windows editor routinely carries one.
  const text = raw.replace(/^\uFEFF/, '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { meta: {}, body: text.trim() };

  const parsed: unknown = parseYaml(match[1] ?? '');
  const meta = parsed && typeof parsed === 'object' ? (parsed as Frontmatter) : {};
  return { meta, body: text.slice(match[0].length).trim() };
}

/**
 * The article's title, and the body with that title removed when it was a heading.
 *
 * Removing it matters: the surface renders the title itself, above the markdown. A body that opens
 * with the same text as an `<h1>` shows it twice, which looks like a bug in the renderer and is
 * really a bug in the source.
 */
export function extractTitle(body: string, declared?: string): { title: string | null; body: string } {
  const heading = /^#\s+(.+?)\s*$/m.exec(body);
  const first = heading && body.slice(0, heading.index).trim() === '' ? heading : null;

  const title = declared?.trim() || first?.[1]?.trim() || null;
  if (!first) return { title, body };

  // Only strip the leading heading when it *is* the title, so a file whose frontmatter names
  // something else keeps both.
  const sameAsTitle = title && first[1]?.trim() === title;
  return { title, body: sameAsTitle ? body.slice((first.index ?? 0) + first[0].length).trim() : body };
}

async function readVariants(directory: string): Promise<{ variants: VariantFile[]; warnings: string[] }> {
  const entries = (await readdir(directory)).sort();
  const variants: VariantFile[] = [];
  const warnings: string[] = [];

  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;

    const match = ARTICLE_FILE.exec(entry);
    if (!match) {
      warnings.push(`${entry}: not named <slug>.<language>.md — skipped`);
      continue;
    }

    const [, slug, language] = match as unknown as [string, string, string];
    const { meta, body } = splitFrontmatter(await readFile(join(directory, entry), 'utf8'));
    variants.push({ slug, language, file: entry, meta, body });
  }

  return { variants, warnings };
}

/**
 * Article-level facts, taken from whichever variant declares them.
 *
 * Labels, source and reading time belong to the *article*, not to a translation of it, so the two
 * files are expected to agree. Where they disagree the first one alphabetically wins and the
 * disagreement is reported — silently preferring one file's source URL is how an article ends up
 * attributed to the wrong post.
 */
function mergeArticleMeta(
  variants: VariantFile[],
  warnings: string[],
  // The *unparsed* shape, because this feeds `articleSchema` — which is what turns a frontmatter
  // date string into a Date. Declaring the parsed shape here would be claiming a coercion that has
  // not happened yet.
): Pick<Frontmatter, 'source' | 'estimatedMinutes'> & { labels: string[] } {
  const slug = variants[0]?.slug ?? '';
  const first = variants[0]?.meta ?? {};

  for (const other of variants.slice(1)) {
    const declaredUrl = other.meta.source?.url;
    if (declaredUrl && first.source?.url && declaredUrl !== first.source.url) {
      warnings.push(`${slug}: ${other.file} names a different source url — kept ${first.source.url}`);
    }
  }

  const labels = [...new Set(variants.flatMap((variant) => variant.meta.labels ?? []))].sort();
  const source = variants.find((variant) => variant.meta.source)?.meta.source;
  const estimatedMinutes = variants.find((variant) => variant.meta.estimatedMinutes)?.meta.estimatedMinutes;

  return {
    labels,
    ...(source ? { source } : {}),
    ...(estimatedMinutes ? { estimatedMinutes } : {}),
  };
}

/**
 * Load every article in a directory, grouped by slug.
 *
 * A variant with no title anywhere is dropped rather than imported under its filename: an untitled
 * article in a library is unfindable, and a wrong title is harder to notice than a missing file.
 */
export async function loadReading(options: { source: string; only?: string }): Promise<LoadedReading> {
  const { variants, warnings } = await readVariants(options.source);

  const bySlug = new Map<string, VariantFile[]>();
  for (const variant of variants) {
    if (options.only && variant.slug !== options.only) continue;
    bySlug.set(variant.slug, [...(bySlug.get(variant.slug) ?? []), variant]);
  }

  const articles: ArticleInput[] = [];

  for (const [slug, group] of [...bySlug.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const bodies: ArticleInput['bodies'] = [];

    for (const variant of group) {
      const { title, body } = extractTitle(variant.body, variant.meta.title);
      if (!title) {
        warnings.push(`${variant.file}: no title in frontmatter and no leading heading — skipped`);
        continue;
      }
      if (!body) {
        warnings.push(`${variant.file}: no text under the title — skipped`);
        continue;
      }
      bodies.push({
        language: variant.language,
        title,
        body,
        ...(variant.meta.summary ? { summary: variant.meta.summary } : {}),
      });
    }

    if (bodies.length === 0) {
      warnings.push(`${slug}: no usable variant — skipped`);
      continue;
    }

    // The schema is the same one the API validates with, so a file that would be refused on
    // publish is refused here — where the filename is still in hand to name in the error.
    const parsed = articleSchema.safeParse({ slug, bodies, ...mergeArticleMeta(group, warnings) });
    if (!parsed.success) {
      warnings.push(`${slug}: ${parsed.error.issues.map((issue) => issue.message).join('; ')} — skipped`);
      continue;
    }

    articles.push(parsed.data);
  }

  return { articles, warnings };
}
