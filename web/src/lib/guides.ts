import 'server-only';

/**
 * A skill's reference guides, read off disk (ADR-0029).
 *
 * A skill is a folder: `skills/<id>/skill.yaml` and, beside it, `skills/<id>/guides/*.md`. The guides
 * are curated, impersonal and public — the narrow exception ADR-0029 makes to ADR-0006 — so they ship
 * with the code and are read here rather than fetched from the api. The cards written from them are
 * content and are not in the tree.
 *
 * `server-only` is load-bearing: a guide corpus is hundreds of KB of markdown, and importing this
 * from a client component would ship it to the browser. The import fails the build instead.
 *
 * The shell layout reads headers, so every page under it renders per request: the files must exist
 * at runtime, not only at build. `infra/docker/web.Dockerfile` copies `skills/` into the image at
 * `/skills`, which is `../skills` from the server's working directory — the same relative path as in
 * a checkout, where `web/` is the working directory.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.env.SKILLS_DIR ?? join(process.cwd(), '..', 'skills');

/** A slug-shaped directory or file name; anything else is not a guide and never reaches the disk. */
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

export interface GuideMeta {
  packId: string;
  slug: string;
  title: string;
  summary: string;
}

export interface Guide extends GuideMeta {
  body: string;
}

/**
 * Frontmatter, parsed without a dependency: `key: value` lines between `---` fences. The contract is
 * two keys, `title` and `summary`; `guides.test.ts` holds every committed guide to it.
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

/** Exported so the test can hold one file to the contract and name the file that broke it. */
export function parse(packId: string, slug: string, source: string): Guide {
  const { fields, body } = frontmatter(source);
  const where = `skills/${packId}/guides/${slug}.md`;
  if (!fields.title) throw new Error(`${where}: missing \`title\``);
  if (!fields.summary) throw new Error(`${where}: missing \`summary\``);
  return { packId, slug, title: fields.title, summary: fields.summary, body: body.trimStart() };
}

/** Held per process: the corpus only changes when the image does. */
const cache = new Map<string, Guide[]>();

/** Every guide of one skill, alphabetical by title. A skill without a `guides/` folder has none. */
export function guidesOf(packId: string): Guide[] {
  if (!SLUG.test(packId)) return [];
  const cached = cache.get(packId);
  if (cached) return cached;

  const directory = join(ROOT, packId, 'guides');
  const guides = existsSync(directory)
    ? readdirSync(directory)
        .filter((name) => name.endsWith('.md'))
        .map((name) => {
          const slug = name.replace(/\.md$/, '');
          return parse(packId, slug, readFileSync(join(directory, name), 'utf8'));
        })
        .sort((a, b) => a.title.localeCompare(b.title, 'en'))
    : [];

  cache.set(packId, guides);
  return guides;
}

/** Labels only — what a list needs, without carrying the bodies through the render. */
export function guideList(packId: string): GuideMeta[] {
  return guidesOf(packId).map(({ body: _body, ...meta }) => meta);
}

export function guideBySlug(packId: string, slug: string): Guide | null {
  if (!SLUG.test(slug)) return null;
  return guidesOf(packId).find((guide) => guide.slug === slug) ?? null;
}

/** Every skill directory in the tree — for the test, which checks the whole corpus. */
export function skillDirectories(): string[] {
  if (!existsSync(ROOT)) return [];
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && SLUG.test(entry.name))
    .map((entry) => entry.name);
}
