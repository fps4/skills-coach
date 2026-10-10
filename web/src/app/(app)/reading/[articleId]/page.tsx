/**
 * One article (ADR-0017).
 *
 * An article opens in the language the skill teaches. Where it has other variants, they are links
 * (`?language=`), so comparing with the original is one click and the choice is in the URL, never
 * in an interface-language setting — there is none any more (ADR-0025). The page says which variant
 * is on screen rather than leaving a learner to work out why the text changed.
 *
 * The markdown pipeline is the wiki's, unchanged: same plugins, same `wiki-prose` styling, rendered
 * on the server so the body ships as HTML with no client JavaScript. Two libraries for one job would
 * mean two sets of rendering bugs. Note that `react-markdown` does not render raw HTML unless
 * `rehype-raw` is added — which is what makes it safe to point at a scraped article, and a reason
 * not to add that plugin here.
 */

import Link from 'next/link';
import { ArrowLeft, Clock, ExternalLink, Languages } from 'lucide-react';
import Markdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';

import { PageShell, Pill } from '@/components/atoms';
import { ReadToggle } from '@/components/read-toggle';
import { api, query } from '@/lib/api';
import { formatDate, readingMinutes } from '@/lib/text';
import { getDictionary } from '@/i18n/dictionaries';
import type { Article } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function ArticlePage({
  params,
  searchParams,
}: {
  params: Promise<{ articleId: string }>;
  searchParams: Promise<{ language?: string }>;
}) {
  const { articleId } = await params;
  const { language } = await searchParams;
  const dictionary = getDictionary();
  const t = dictionary.reading;

  const { article } = await api<{ article: Article }>(`/api/v1/reading/${articleId}${query({ language })}`);

  const library = `/reading?packId=${article.packId}`;
  // Counted from the variant on screen when the loader did not say, so a translation that runs
  // longer than its original reports its own length rather than the other one's.
  const minutes = article.estimatedMinutes ?? readingMinutes(article.body);
  const others = article.languages.filter((other) => other !== article.language);

  return (
    <PageShell
      title={<span lang={article.language}>{article.title}</span>}
      back={
        <Link
          href={library}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t.backToLibrary}
        </Link>
      }
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {article.source?.site ? <span>{article.source.site}</span> : null}
          {article.source?.author ? <span>{article.source.author}</span> : null}
          {article.source?.publishedAt ? <span>{formatDate(article.source.publishedAt)}</span> : null}
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {minutes} {t.readingTime}
          </span>
        </span>
      }
    >
      {article.labels.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {article.labels.map((label) => (
            <Pill key={label}>{label}</Pill>
          ))}
        </div>
      ) : null}

      {/* What language this is, and which other variants there are to compare with. */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <Languages className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium uppercase tracking-wide">{article.language}</span>
        {!article.inRequestedLanguage ? <span>{t.fallbackNotice}</span> : null}
        {others.length > 0 ? (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            {t.switchHint}
            {others.map((other) => (
              <Link
                key={other}
                href={`/reading/${article.articleId}${query({ language: other })}`}
                className="font-medium uppercase tracking-wide underline underline-offset-2 hover:text-foreground"
              >
                {other}
              </Link>
            ))}
          </span>
        ) : article.inRequestedLanguage ? (
          <span>{t.onlyLanguage}</span>
        ) : null}
      </div>

      {/* `lang` is the *variant's* language, not the pack's and not the interface's — which is the
          whole point of a parallel text, and what makes a screen reader switch voice with it. */}
      <article lang={article.language} className="wiki-prose">
        <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug, rehypeHighlight]}>
          {article.body}
        </Markdown>
      </article>

      <div className="space-y-3 border-t border-border pt-5">
        <ReadToggle articleId={article.articleId} readAt={article.readAt} library={library} dictionary={dictionary} />
        {article.source?.url ? (
          <p>
            <a
              href={article.source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t.readOriginal}
            </a>
          </p>
        ) : null}
      </div>
    </PageShell>
  );
}
