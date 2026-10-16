/**
 * One search result's text: what it is, where it is, and the snippet with the matched words marked
 * (ADR-0030). Shared by the bar's popover and the results page, so a result reads the same in both.
 *
 * The snippet arrives as parts rather than HTML, so marking a word never means trusting markup from
 * a guide or a card.
 */

import { FileText, Layers } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { SearchHit, SnippetPart } from '@/lib/search';

export function Snippet({ parts, className }: { parts: SnippetPart[]; className?: string }) {
  if (parts.length === 0) return null;
  return (
    <p className={cn('text-muted-foreground', className)}>
      {parts.map((part, index) =>
        part.match ? (
          <mark key={index} className="rounded-sm bg-primary/20 px-0.5 text-foreground">
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </p>
  );
}

/** "Guide · Skill" for a section, "Skill · Group" for a card — the line that says where a result lives. */
export function whereLine(hit: SearchHit): string {
  return [hit.kind === 'guide' ? hit.context : hit.skillTitle, hit.kind === 'guide' ? hit.skillTitle : hit.context]
    .filter(Boolean)
    .join(' · ');
}

export function SearchResultBody({ hit, compact = false }: { hit: SearchHit; compact?: boolean }) {
  const Icon = hit.kind === 'guide' ? FileText : Layers;
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 space-y-0.5">
        <p className={cn('font-medium leading-snug', compact ? 'truncate text-sm' : 'text-base')}>{hit.title}</p>
        <p className="truncate text-xs text-muted-foreground">{whereLine(hit)}</p>
        <Snippet parts={hit.snippet} className={cn(compact ? 'line-clamp-2 text-xs' : 'text-sm')} />
      </div>
    </div>
  );
}
