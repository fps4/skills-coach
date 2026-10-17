/**
 * One guide, rendered (ADR-0029).
 *
 * The markdown pipeline runs on the server, so the body ships as HTML with no client JavaScript —
 * a long guide with many code blocks costs the browser nothing beyond the markup.
 *
 * Its foot links the flashcard topics written from it (ADR-0032), so reading and practising are one
 * click apart in both directions: a topic's tile on the overview links back here.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import Markdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';

import { Meter, PageShell } from '@/components/atoms';
import { api } from '@/lib/api';
import { guideBySlug } from '@/lib/guides';
import { topicHref, topicsOfGuide, type TopicSummary } from '@/lib/topics';
import type { PackProgress } from '@/lib/types';
import { getDictionary } from '@/i18n/dictionaries';

type Params = Promise<{ packId: string; slug: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { packId, slug } = await params;
  const guide = guideBySlug(packId, slug);
  return guide ? { title: guide.title, description: guide.summary } : {};
}

/**
 * The deck the skill's Flashcards tab opens, and the topics in it written from this guide. None when
 * the skill declares no topics, or the api cannot say — a guide reads the same without its footer.
 */
async function practisedIn(packId: string, slug: string): Promise<{ blockId: string; topics: TopicSummary[] } | null> {
  try {
    const progress = await api<PackProgress>(`/api/v1/progress?packId=${encodeURIComponent(packId)}`);
    const topics = topicsOfGuide(progress.decks.topics, slug);
    return progress.currentBlock && topics.length > 0 ? { blockId: progress.currentBlock.blockId, topics } : null;
  } catch {
    return null;
  }
}

export default async function GuidePage({ params }: { params: Params }) {
  const { packId, slug } = await params;
  const guide = guideBySlug(packId, slug);
  if (!guide) notFound();

  const t = getDictionary().guides;
  const practice = await practisedIn(packId, slug);

  return (
    <PageShell
      title={<span lang="en">{guide.title}</span>}
      subtitle={<span lang="en">{guide.summary}</span>}
      back={
        <Link
          href={`/guides/${packId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {t.back}
        </Link>
      }
    >
      <article lang="en" className="article-prose">
        <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug, rehypeHighlight]}>
          {guide.body}
        </Markdown>
      </article>

      {practice ? (
        <section aria-labelledby="guide-practise" className="space-y-3 border-t border-border pt-6">
          <div>
            <h2 id="guide-practise" className="text-base font-semibold">
              {t.practise}
            </h2>
            <p className="text-sm text-muted-foreground">{t.practiseHint}</p>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {practice.topics.map((topic) => (
              <li key={topic.id}>
                <Link
                  href={topicHref(practice.blockId, topic.id)}
                  className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/50"
                >
                  <span className="flex items-baseline justify-between gap-2 text-sm font-medium">
                    <span className="min-w-0 break-words">{topic.title}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {topic.summary.mastered}/{topic.summary.total}
                    </span>
                  </span>
                  <Meter value={topic.summary.mastered} total={topic.summary.total} tone="success" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </PageShell>
  );
}
