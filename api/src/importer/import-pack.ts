/**
 * `npm run import:pack -- --source <dir> [--manifest <file>] [--only <n>] [--dry-run]`
 *
 * Reads a pack from a local directory and publishes it through the coach API. Content lives
 * wherever the author keeps it — the repository holds only the demo pack (ADR-0006) — so this takes
 * a path and never assumes one.
 *
 * Publishing goes over HTTP rather than straight into MongoDB deliberately: the importer is then
 * just another coach-API caller, and anything it can do, a person or a service can do too.
 */

import { loadManifest, loadPack } from './pack-source.js';

interface Args {
  source: string;
  manifest?: string;
  only?: number;
  dryRun: boolean;
  /** Publish the manifest and stop — for a pack whose blocks are authored elsewhere, or not yet. */
  manifestOnly: boolean;
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
  if (typeof source !== 'string') {
    throw new Error(
      'usage: import:pack --source <dir> [--manifest <file>] [--only <block>] [--manifest-only] ' +
        '[--dry-run] [--api-url <url>] [--token <token>]',
    );
  }

  return {
    source,
    manifest: typeof args.manifest === 'string' ? args.manifest : undefined,
    only: typeof args.only === 'string' ? Number(args.only) : undefined,
    dryRun: args['dry-run'] === true,
    manifestOnly: args['manifest-only'] === true,
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
  if (!response.ok) {
    throw new Error(`POST ${path} → ${response.status}\n${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const log = (message: string): void => {
    process.stdout.write(`${message}\n`);
  };

  // A pack whose blocks live outside the tree — or do not exist yet — still has a manifest worth
  // publishing: it is what makes the pack appear at all, so a learner can open it and a coach can
  // author against its ramp. `loadPack` insists on a block directory, and rightly; this path does
  // not go through it.
  if (args.manifestOnly) {
    const manifest = await loadManifest(args.manifest ?? `${args.source}/pack.yaml`);
    log(`pack     ${manifest.packId} (${manifest.contentLanguage} → ${manifest.translationLanguage})`);
    log(`manifest only — no blocks are published by this run`);

    if (args.dryRun) {
      log('\n--dry-run: nothing was published.');
      return;
    }

    log(`\npublishing to ${args.apiUrl}`);
    await post(args, '/coach/v1/packs', manifest);
    log(`  pack ${manifest.packId} ✓`);
    log('\ndone.');
    return;
  }

  const { manifest, blocks, warnings } = await loadPack({
    source: args.source,
    manifest: args.manifest,
    only: args.only,
  });

  log(`pack     ${manifest.packId} (${manifest.contentLanguage} → ${manifest.translationLanguage})`);
  log(`blocks   ${blocks.length}`);
  for (const block of blocks) {
    const terms = block.drillItems.filter((item) => item.payload.kind === 'term').length;
    const sentences = block.drillItems.filter((item) => item.payload.kind === 'word-order').length;
    log(
      `  ${String(block.order).padStart(2, '0')} ${block.slug} — ${block.lessons.length} lessons, ${terms} terms, ${sentences} sentences`,
    );
  }

  // Never silent: a heading that degraded to prose or a row that was skipped is reported, because
  // a lossy import that looks clean is worse than one that fails.
  if (warnings.length > 0) {
    log(`\n${warnings.length} warning${warnings.length === 1 ? '' : 's'}:`);
    for (const warning of warnings) log(`  · ${warning}`);
  }

  if (args.dryRun) {
    log('\n--dry-run: nothing was published.');
    return;
  }

  log(`\npublishing to ${args.apiUrl}`);
  await post(args, '/coach/v1/packs', manifest);
  log(`  pack ${manifest.packId} ✓`);

  for (const block of blocks) {
    const result = (await post(args, `/coach/v1/packs/${manifest.packId}/blocks`, block)) as {
      lessonsPublished: number;
      drillItemsPublished: number;
      drillItemsRemoved: number;
      ignoredAlternatives: number;
    };
    const ignored =
      result.ignoredAlternatives > 0 ? `, ${result.ignoredAlternatives} alternative order(s) ignored` : '';
    const removed = result.drillItemsRemoved > 0 ? `, ${result.drillItemsRemoved} stale drill(s) removed` : '';
    log(
      `  block ${block.order} ${block.slug} ✓ — ${result.lessonsPublished} lessons, ${result.drillItemsPublished} drills${ignored}${removed}`,
    );
  }

  log('\ndone.');
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
