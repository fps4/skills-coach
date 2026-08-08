import 'server-only';

/**
 * Reading the wiki off disk.
 *
 * The guides are files in the repository rather than rows behind the api, which is the exception
 * [ADR-0016](../../../docs/architecture/decisions/0016-the-reference-library-ships-with-the-code.md)
 * grants to [ADR-0006](../../../docs/architecture/decisions/0006-content-and-learner-data-stay-out-of-the-repo.md).
 * Read that first — the short version is that this library is impersonal, public, and revised on the
 * same clock as the code, none of which is true of a pack.
 *
 * `server-only` is load-bearing. The corpus is ~800 KB of markdown; importing it from a client
 * component would ship all of it to the browser, and the import would fail at build time instead,
 * which is the point.
 *
 * **These reads happen at build time, not at request time.** Both wiki routes are prerendered —
 * `generateStaticParams` enumerates every guide — so the standalone runtime serves HTML and never
 * opens this directory. Two consequences worth knowing before changing anything here:
 *
 * - Next's file tracer does find `content/wiki` on its own, and the guides survive into the image
 *   without an `outputFileTracingIncludes` entry. Both facts were verified, not assumed.
 * - A route that stopped being prerendered *would* need the files at runtime. If you add one that
 *   reads a guide dynamically, check the trace picks the directory up rather than trusting it.
 *
 * The corpus is only *in* the tree because `.gitignore` un-ignores it explicitly: ADR-0006's
 * `content/` rule matches at any depth and would otherwise exclude every guide silently.
 * `wiki.test.ts` asserts the corpus is non-empty, so that failure is a red build rather than an
 * empty library in production.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { isFormat, isTopic, type WikiGuide, type WikiMeta } from './wiki-labels';

const DIRECTORY = join(process.cwd(), 'content', 'wiki');

/**
 * Frontmatter, parsed without a dependency.
 *
 * The contract is deliberately narrow — `key: value` and one `[a, b]` list — because it is ours and
 * a guide that needs more expressive frontmatter is a guide asking for a feature. Anything the
 * shape does not cover fails validation loudly in `parse`, so this cannot quietly mis-read a file.
 */
function frontmatter(source: string): { fields: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) return { fields: {}, body: source };

  const fields: Record<string, string> = {};
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key) fields[key] = value.replace(/^["']|["']$/g, '');
  }

  return { fields, body: source.slice(match[0].length) };
}

function list(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((entry) => entry.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

/** Exported so the test can hold one file to the contract and name the file that broke it. */
export function parse(slug: string, source: string): WikiGuide {
  const { fields, body } = frontmatter(source);

  /**
   * Declared as a `function` rather than an arrow so its `never` return participates in control-flow
   * narrowing — that is what lets the checks below act as type guards instead of needing casts.
   */
  function fail(reason: string): never {
    throw new Error(`content/wiki/${slug}.md: ${reason}`);
  }

  const { title, summary, topic, format, updated } = fields;

  if (!title) fail('missing `title`');
  if (!summary) fail('missing `summary`');
  if (!isTopic(topic)) fail(`unknown topic \`${topic ?? ''}\``);
  if (!isFormat(format)) fail(`unknown format \`${format ?? ''}\``);
  if (!updated || !/^\d{4}-\d{2}-\d{2}$/.test(updated)) fail(`\`updated\` must be YYYY-MM-DD, got \`${updated ?? ''}\``);

  return {
    slug,
    title,
    summary,
    topic,
    format,
    tags: list(fields.tags),
    updated,
    body: body.trimStart(),
  };
}

/**
 * Every guide, parsed once per process.
 *
 * The corpus only changes when the image does, so this is read at first use and held. A guide that
 * fails the contract throws here, which surfaces as a build failure rather than a missing tile.
 */
let cache: WikiGuide[] | null = null;

export function allGuides(): WikiGuide[] {
  if (cache) return cache;

  const files = readdirSync(DIRECTORY).filter((name) => name.endsWith('.md'));
  const guides = files.map((name) => {
    const slug = name.replace(/\.md$/, '');
    return parse(slug, readFileSync(join(DIRECTORY, name), 'utf8'));
  });

  // Alphabetical by title, so the grid has an order that does not depend on the filesystem.
  guides.sort((a, b) => a.title.localeCompare(b.title, 'en'));
  cache = guides;
  return guides;
}

/** Labels only — what the index needs, without carrying ~800 KB of bodies through the render. */
export function allMeta(): WikiMeta[] {
  return allGuides().map(({ body: _body, ...meta }) => meta);
}

export function guideBySlug(slug: string): WikiGuide | null {
  return allGuides().find((guide) => guide.slug === slug) ?? null;
}
