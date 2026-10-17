/**
 * Voortgang — where a pack lands: the live error log, plus deck standings.
 *
 * The source program kept this by hand across three markdown files. Here it is derived from what
 * actually happened, so it cannot be out of date — which is the point, because this is the evidence
 * the next block gets written from.
 *
 * **One skill, named in the query** (ADR-0018, ADR-0021). This is the pack's own page rather than a report
 * spanning every pack the learner has: it is what the rail's pack item opens, so it answers "how am
 * I doing *here*". Without a `packId` there is no pack to report on, and the landing page — which is
 * the product's list of packs — is the honest answer.
 *
 * Everything here is advisory: a sequencing signal, never a grade.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BarChart3, FileText, ListChecks, Newspaper, Puzzle, Sparkles } from 'lucide-react';

import { Meter, PageShell, Pill, Stat } from '@/components/atoms';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { guideList, type GuideMeta } from '@/lib/guides';
import { formatDate, statusLabel, statusTone } from '@/lib/text';
import { topicHref, topicTitle, type TopicSummary } from '@/lib/topics';
import { getDictionary, type Dictionary } from '@/i18n/dictionaries';
import type { DeckSummary, PackProgress } from '@/lib/types';

export const dynamic = 'force-dynamic';

function DeckRow({ label, summary, dictionary }: { label: string; summary: DeckSummary; dictionary: Dictionary }) {
  if (summary.total === 0) return null;

  return (
    <div className="space-y-2 border-b border-border/60 py-3 last:border-0">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <span className="w-24 font-medium">{label}</span>
        <span className="text-sm text-muted-foreground">
          {dictionary.progress.total}: <span className="tabular-nums text-foreground">{summary.total}</span>
        </span>
        <span className="text-sm text-muted-foreground">
          {dictionary.progress.unlocked}: <span className="tabular-nums text-foreground">{summary.stage1Cleared}</span>
        </span>
        <span className="text-sm text-muted-foreground">
          {dictionary.block.mastered}: <span className="tabular-nums text-success">{summary.mastered}</span>
        </span>
      </div>
      <Meter value={summary.mastered} total={summary.total} tone="success" />
    </div>
  );
}

/**
 * One topic of the deck (ADR-0031): its name opens practice on just that topic, and *Learn* opens it
 * with the answers showing. How much of it is mastered is the bar; nothing here ranks topics.
 *
 * A declared topic (ADR-0032) also says what it covers, and links the guides it is practised from —
 * read the guide, practise the topic, and go back to the guide when a card trips you up.
 */
function TopicTile({
  packId,
  blockId,
  topic,
  guides,
  dictionary,
}: {
  packId: string;
  blockId: string;
  topic: TopicSummary;
  guides: GuideMeta[];
  dictionary: Dictionary;
}) {
  const { summary } = topic;
  const done = summary.total > 0 && summary.mastered === summary.total;
  const title = topicTitle(topic, dictionary.flashcards.noTopic);

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/50">
      <Link href={topicHref(blockId, topic.id)} className="min-w-0 break-words text-sm font-medium hover:text-primary">
        {title}
      </Link>
      {topic.description ? <p className="text-xs text-muted-foreground">{topic.description}</p> : null}
      <Meter value={summary.mastered} total={summary.total} tone={done ? 'success' : 'primary'} />
      <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {summary.mastered}/{summary.total} {dictionary.block.mastered.toLowerCase()}
        </span>
        <Link
          href={topicHref(blockId, topic.id, 'learn')}
          className="hover:text-foreground"
          aria-label={`${dictionary.flashcards.learn}: ${title}`}
        >
          {dictionary.flashcards.learn}
        </Link>
      </div>
      {guides.length > 0 ? (
        <ul className="space-y-0.5 border-t border-border/60 pt-2 text-xs" aria-label={dictionary.guides.title}>
          {guides.map((guide) => (
            <li key={guide.slug}>
              <Link
                href={`/guides/${encodeURIComponent(packId)}/${encodeURIComponent(guide.slug)}`}
                className="inline-flex items-start gap-1.5 text-muted-foreground hover:text-foreground"
              >
                <FileText className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                <span>{guide.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export default async function ProgressPage({ searchParams }: { searchParams: Promise<{ packId?: string }> }) {
  const { packId } = await searchParams;
  const dictionary = getDictionary();
  const t = dictionary.progress;

  if (!packId) redirect('/');

  const entry = await api<PackProgress>(`/api/v1/progress?packId=${encodeURIComponent(packId)}`);
  const recurring = entry.errorLog.entries.filter((row) => row.status === 'recurring').length;
  const tracksErrors = entry.pack.errorCategories.length > 0;
  const hasDecks = entry.decks.terms.total + entry.decks.wordOrder.total + entry.decks.quiz.total > 0;
  const guides = entry.decks.topics.some((topic) => topic.guides?.length) ? guideList(packId) : [];

  return (
    // The skill's name is already in the header above (ADR-0021); this page is its overview.
    <PageShell tab title={dictionary.nav.overview}>
      {/*
        Only what this skill actually has: a skill that is only a word deck or only a reading list
        has no sentences and nothing on its error log to count (ADR-0022).
      */}
      <div className="grid gap-3 sm:grid-cols-3">
        {entry.decks.terms.total > 0 ? (
          <Stat
            icon={<Sparkles className="h-4 w-4 text-primary" />}
            value={`${entry.decks.terms.mastered}/${entry.decks.terms.total}`}
            label={t.words.toLowerCase()}
          />
        ) : null}
        {entry.decks.wordOrder.total > 0 ? (
          <Stat
            icon={<Puzzle className="h-4 w-4 text-primary" />}
            value={`${entry.decks.wordOrder.mastered}/${entry.decks.wordOrder.total}`}
            label={t.sentences.toLowerCase()}
          />
        ) : null}
        {entry.reading.total > 0 ? (
          <Stat
            icon={<Newspaper className="h-4 w-4 text-primary" />}
            value={`${entry.reading.unread}/${entry.reading.total}`}
            label={dictionary.home.unread}
          />
        ) : null}
        {tracksErrors ? (
          <Stat
            icon={<BarChart3 className="h-4 w-4 text-muted-foreground" />}
            value={recurring}
            label={t.redrill.toLowerCase()}
          />
        ) : null}
      </div>

      {/* Words a coach filled in, waiting on the learner (ADR-0023). */}
      {entry.wordRequests.ready > 0 && entry.currentBlock ? (
        <Card className="border-primary/40">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-5">
            <p className="flex items-center gap-2 text-sm">
              <Sparkles className="h-4 w-4 text-primary" />
              <span>
                <span className="font-semibold tabular-nums">{entry.wordRequests.ready}</span> {dictionary.assist.readyCallout}
              </span>
            </p>
            <Button asChild size="sm">
              <Link href={`/flashcards?blockId=${encodeURIComponent(entry.currentBlock.blockId)}&view=add`}>
                {dictionary.assist.review}
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {hasDecks ? (
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-base">{t.decks}</CardTitle>
          </CardHeader>
          <CardContent>
            <DeckRow label={t.words} summary={entry.decks.terms} dictionary={dictionary} />
            <DeckRow label={t.sentences} summary={entry.decks.wordOrder} dictionary={dictionary} />
            <DeckRow label={dictionary.nav.quiz} summary={entry.decks.quiz} dictionary={dictionary} />
          </CardContent>
        </Card>
      ) : null}

      {/* The deck by topic, when its cards have topics (ADR-0031). Each tile opens just that topic. */}
      {entry.decks.topics.length > 0 && entry.currentBlock ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t.topics}</CardTitle>
            <p className="text-sm text-muted-foreground">{t.topicsIntro}</p>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {entry.decks.topics.map((topic) => (
                <TopicTile
                  key={topic.id}
                  packId={packId}
                  blockId={entry.currentBlock!.blockId}
                  topic={topic}
                  // Only guides that exist: a slug the manifest names but the tree lacks links nowhere.
                  guides={(topic.guides ?? []).flatMap((slug) => guides.find((guide) => guide.slug === slug) ?? [])}
                  dictionary={dictionary}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {/* Only for packs that actually quiz. Advisory throughout — see ADR-0014. */}
      {entry.quiz.sessions > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="h-4 w-4 text-primary" />
              {dictionary.quiz.byDomain}
            </CardTitle>
            <p className="max-w-prose text-sm text-muted-foreground">{dictionary.quiz.scoreHint}</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {entry.quiz.byCategory.map((row) => (
              <div key={row.category} className="space-y-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
                  {/* Pack-authored, so rendered as written (ADR-0005). */}
                  <span className="min-w-0 break-words font-medium">{row.category}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {row.correct}/{row.asked}
                  </span>
                </div>
                <Meter
                  value={row.correct}
                  total={row.asked}
                  tone={row.accuracy >= 0.7 ? 'success' : row.accuracy >= 0.4 ? 'primary' : 'muted'}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {tracksErrors ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t.errorLog}</CardTitle>
            <p className="max-w-prose text-sm text-muted-foreground">{t.errorLogIntro}</p>
          </CardHeader>

          <CardContent>
            {entry.errorLog.entries.length === 0 ? (
              <>
                <p className="text-sm">{t.noErrors}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t.noErrorsHint}</p>
              </>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        <th className="py-2 pr-4 font-medium">{t.category}</th>
                        <th className="py-2 pr-4 font-medium">{t.example}</th>
                        <th className="py-2 pr-4 text-right font-medium">{t.count}</th>
                        <th className="py-2 pr-4 font-medium">{t.lastSeen}</th>
                        <th className="py-2 font-medium">{t.status}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entry.errorLog.entries.map((row) => {
                        const example = row.examples.at(-1);
                        return (
                          <tr key={row.category} className="border-b border-border/60 align-top last:border-0">
                            {/* The category id is pack-authored content — rendered as written. */}
                            <td className="py-2 pr-4 font-medium">{row.category}</td>
                            <td className="py-2 pr-4 text-muted-foreground" lang={entry.pack.contentLanguage}>
                              {example ? (
                                <>
                                  <span className="line-through decoration-destructive/60">{example.wrong}</span>
                                  {' → '}
                                  <span className="text-success">{example.right}</span>
                                </>
                              ) : null}
                            </td>
                            <td className="py-2 pr-4 text-right tabular-nums">{row.count}</td>
                            <td className="py-2 pr-4 text-muted-foreground">{formatDate(row.lastSeen)}</td>
                            <td className="py-2">
                              <Pill tone={statusTone(row.status)}>{statusLabel(row.status, dictionary)}</Pill>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {entry.errorLog.redrill.length > 0 ? (
                  <p className="mt-4 text-sm">
                    <span className="font-medium">{t.redrill}: </span>
                    <span className="text-muted-foreground">{entry.errorLog.redrill.join(' · ')}</span>
                  </p>
                ) : null}
                {entry.errorLog.retire.length > 0 ? (
                  <p className="mt-1 text-sm">
                    <span className="font-medium">{t.retired}: </span>
                    <span className="text-muted-foreground">{entry.errorLog.retire.join(' · ')}</span>
                  </p>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      ) : null}
    </PageShell>
  );
}
