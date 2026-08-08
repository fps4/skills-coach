/**
 * `npm run import:reading -- --source <dir> --pack <packId> --learner <learnerId> [--dry-run]`
 *
 * Loads a directory of markdown articles into one learner's reading library through the coach API
 * (ADR-0017). Content lives wherever it was scraped, converted and translated — never in this
 * repository (ADR-0006) — so this takes a path and never assumes one.
 *
 * Like `import:pack`, it publishes over HTTP rather than into MongoDB: the loader is then just
 * another coach-API caller, and anything it can do, an agent holding the same token can do through
 * the `upsert_reading` tool instead. That is the point — this script is the bulk door for material
 * that has already been prepared, not a second way of deciding what a library holds.
 *
 * Batched, because a translated article is tens of kilobytes and forty of them in one request is a
 * body no proxy should be asked to hold.
 */

import { loadReading } from './reading-source.js';
import type { ArticleInput } from '../domain/schemas.js';

const BATCH_SIZE = 5;

interface Args {
  source: string;
  packId: string;
  learnerId: string;
  only?: string;
  dryRun: boolean;
  apiUrl: string;
  token: string;
}

function parseArgs(argv: string[]): Args {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }

  const source = args.source ?? args.s;
  const packId = args.pack ?? args.packId;
  const learnerId = args.learner ?? args.learnerId;

  if (typeof source !== 'string' || typeof packId !== 'string' || typeof learnerId !== 'string') {
    throw new Error(
      'usage: import:reading --source <dir> --pack <packId> --learner <learnerId> ' +
        '[--only <slug>] [--dry-run] [--api-url <url>] [--token <token>]',
    );
  }

  return {
    source,
    packId,
    learnerId,
    only: typeof args.only === 'string' ? args.only : undefined,
    dryRun: args['dry-run'] === true,
    apiUrl:
      (typeof args['api-url'] === 'string' ? args['api-url'] : process.env.COACH_API_URL) ?? 'http://127.0.0.1:8010',
    // Local development runs AUTH_MODE=dev, where any bearer value is accepted.
    token: (typeof args.token === 'string' ? args.token : process.env.COACH_API_TOKEN) ?? 'dev',
  };
}

async function post(args: Args, path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${args.apiUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${args.token}` },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`POST ${path} → ${response.status}\n${text}`);
  return text ? JSON.parse(text) : null;
}

function describe(article: ArticleInput): string {
  const languages = article.bodies.map((body) => body.language).join('+');
  const words = article.bodies.reduce((total, body) => total + body.body.split(/\s+/).length, 0);
  const labels = article.labels.length > 0 ? ` [${article.labels.join(', ')}]` : '';
  return `${article.slug} — ${languages}, ~${words} words${labels}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const log = (message: string): void => {
    process.stdout.write(`${message}\n`);
  };

  const { articles, warnings } = await loadReading({ source: args.source, only: args.only });

  log(`pack     ${args.packId}`);
  log(`learner  ${args.learnerId}`);
  log(`articles ${articles.length}`);
  for (const article of articles) log(`  · ${describe(article)}`);

  // An article with one variant is loadable and useful — but the language switch has nothing to do
  // on it, which is the whole point of the surface, so it is called out rather than assumed.
  const single = articles.filter((article) => article.bodies.length === 1);
  if (single.length > 0) {
    log(`\n${single.length} article(s) carry only one language — the switch will not flip them:`);
    for (const article of single) log(`  · ${article.slug} (${article.bodies[0]?.language})`);
  }

  const unattributed = articles.filter((article) => !article.source?.url);
  if (unattributed.length > 0) {
    log(`\n${unattributed.length} article(s) carry no source url:`);
    for (const article of unattributed) log(`  · ${article.slug}`);
  }

  // Never silent: a file skipped or a heading that produced nothing is reported, because a lossy
  // import that looks clean is worse than one that fails.
  if (warnings.length > 0) {
    log(`\n${warnings.length} warning${warnings.length === 1 ? '' : 's'}:`);
    for (const warning of warnings) log(`  · ${warning}`);
  }

  if (articles.length === 0) {
    log('\nnothing to load.');
    return;
  }

  if (args.dryRun) {
    log('\n--dry-run: nothing was loaded.');
    return;
  }

  log(`\nloading into ${args.apiUrl}`);
  let added = 0;
  let updated = 0;

  for (let i = 0; i < articles.length; i += BATCH_SIZE) {
    const batch = articles.slice(i, i + BATCH_SIZE);
    const result = (await post(args, `/coach/v1/packs/${args.packId}/reading`, {
      learnerId: args.learnerId,
      articles: batch,
    })) as { added: number; updated: number };
    added += result.added;
    updated += result.updated;
    log(`  ${Math.min(i + BATCH_SIZE, articles.length)}/${articles.length} ✓`);
  }

  log(`\ndone — ${added} added, ${updated} updated.`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
