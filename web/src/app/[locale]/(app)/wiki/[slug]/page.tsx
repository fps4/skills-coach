/**
 * One guide, rendered.
 *
 * Everything here runs on the server, including the markdown pipeline: the article body ships as
 * HTML with **no client JavaScript at all**. A 500-line guide with 30 code blocks costs the browser
 * nothing beyond the markup, which is the whole reason the corpus can live in the repository rather
 * than behind an API.
 *
 * `lang="en"` on the body is the ADR-0005 rule applied to a second kind of content: the guides are
 * written in English and render untouched in a Dutch interface, exactly as a Dutch pack renders
 * untouched in an English one. The chrome around them is translated; the material never is.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import Markdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';

import { PageShell, Pill } from '@/components/atoms';
import { allMeta, guideBySlug } from '@/lib/wiki';
import { formatDate } from '@/lib/text';
import { getDictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';

/** The corpus is fixed at build time, so every guide is a known route. */
export function generateStaticParams() {
  return allMeta().map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = guideBySlug(slug);
  return guide ? { title: guide.title, description: guide.summary } : {};
}

export default async function WikiGuidePage({ params }: { params: Promise<{ locale: Locale; slug: string }> }) {
  const { locale, slug } = await params;
  const guide = guideBySlug(slug);
  if (!guide) notFound();

  const dictionary = getDictionary(locale);
  const t = dictionary.wiki;

  return (
    <PageShell
      title={<span lang="en">{guide.title}</span>}
      subtitle={<span lang="en">{guide.summary}</span>}
      back={
        <Link
          href={`/${locale}/wiki`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {t.backToWiki}
        </Link>
      }
    >
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Pill tone="primary">{t.topics[guide.topic]}</Pill>
        <Pill>{t.formats[guide.format]}</Pill>
        <span className="ml-auto">
          {t.updated} {formatDate(guide.updated, locale)}
        </span>
      </div>

      {/* Only worth saying where it is not obvious — a Dutch interface around English material. */}
      {locale !== 'en' ? <p className="text-xs text-muted-foreground">{t.englishNote}</p> : null}

      <article lang="en" className="wiki-prose">
        <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug, rehypeHighlight]}>
          {guide.body}
        </Markdown>
      </article>
    </PageShell>
  );
}
