/**
 * One guide, rendered (ADR-0029).
 *
 * The markdown pipeline runs on the server, so the body ships as HTML with no client JavaScript —
 * a long guide with many code blocks costs the browser nothing beyond the markup.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import Markdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';

import { PageShell } from '@/components/atoms';
import { guideBySlug } from '@/lib/guides';
import { getDictionary } from '@/i18n/dictionaries';

type Params = Promise<{ packId: string; slug: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { packId, slug } = await params;
  const guide = guideBySlug(packId, slug);
  return guide ? { title: guide.title, description: guide.summary } : {};
}

export default async function GuidePage({ params }: { params: Params }) {
  const { packId, slug } = await params;
  const guide = guideBySlug(packId, slug);
  if (!guide) notFound();

  const t = getDictionary().guides;

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
    </PageShell>
  );
}
