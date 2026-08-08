'use client';

/**
 * The chip rows and the search box above the wiki grid.
 *
 * This component **filters nothing**. It writes the query string and lets the server component
 * re-render the grid from it, which is what keeps ~800 KB of guide metadata off the client and makes
 * a filtered view a shareable URL rather than a state a reload throws away.
 *
 * Counts come from the server too, computed against the rest of the filter, so a chip reading `0` is
 * a real dead end. Those are rendered disabled — visible, because a row of chips that appears and
 * disappears as you filter is harder to learn than one that explains itself. Same rule as the
 * learner rail.
 */

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { Search, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { FORMATS, TOPICS, toQuery, type WikiFilter } from '@/lib/wiki-labels';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';

interface Props {
  locale: Locale;
  dictionary: Dictionary;
  filter: WikiFilter;
  topicCounts: Record<string, number>;
  formatCounts: Record<string, number>;
  total: number;
}

export function WikiFilters({ locale, dictionary, filter, topicCounts, formatCounts, total }: Props) {
  const t = dictionary.wiki;
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  // The box is typed into continuously but the URL is only written after a pause, so a search does
  // not push one history entry per keystroke.
  const [query, setQuery] = useState(filter.q ?? '');

  // A back/forward navigation changes the URL without touching this state, so follow it.
  useEffect(() => {
    setQuery(params.get('q') ?? '');
  }, [params]);

  const navigate = (next: WikiFilter) => {
    startTransition(() => router.replace(`/${locale}/wiki${toQuery(next)}`, { scroll: false }));
  };

  useEffect(() => {
    const current = params.get('q') ?? '';
    if (query === current) return;

    const timer = setTimeout(() => {
      navigate({ topic: params.get('topic'), format: params.get('format'), q: query || null });
    }, 250);
    return () => clearTimeout(timer);
    // `navigate` is stable enough for this; re-running on every render would reset the timer forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, params]);

  /** Clicking the selected chip clears that axis — the chip is a toggle, not a radio button. */
  const toggle = (axis: 'topic' | 'format', value: string) => {
    navigate({ ...filter, [axis]: filter[axis] === value ? null : value });
  };

  const active = Boolean(filter.topic || filter.format || filter.q);

  return (
    <div className={cn('space-y-3', pending && 'opacity-70 transition-opacity')}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t.searchPlaceholder}
          aria-label={t.search}
          className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none ring-ring placeholder:text-muted-foreground focus-visible:ring-2"
        />
      </div>

      <ChipRow
        label={t.topic}
        all={t.allTopics}
        values={TOPICS}
        names={t.topics}
        counts={topicCounts}
        selected={filter.topic ?? null}
        onSelect={(value) => toggle('topic', value)}
        onClear={() => navigate({ ...filter, topic: null })}
      />

      <ChipRow
        label={t.format}
        all={t.allFormats}
        values={FORMATS}
        names={t.formats}
        counts={formatCounts}
        selected={filter.format ?? null}
        onSelect={(value) => toggle('format', value)}
        onClear={() => navigate({ ...filter, format: null })}
      />

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>
          {total} {t.results}
        </span>
        {active ? (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              navigate({});
            }}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
          >
            <X className="h-3 w-3" /> {t.clearFilters}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ChipRow<T extends string>({
  label,
  all,
  values,
  names,
  counts,
  selected,
  onSelect,
  onClear,
}: {
  label: string;
  all: string;
  values: readonly T[];
  names: Record<T, string>;
  counts: Record<string, number>;
  selected: string | null;
  onSelect: (value: T) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      <Chip active={selected === null} onClick={onClear}>
        {all}
      </Chip>
      {values.map((value) => {
        const count = counts[value] ?? 0;
        const isSelected = selected === value;
        return (
          <Chip
            key={value}
            active={isSelected}
            // The selected chip stays clickable so it can toggle itself off, even at zero.
            disabled={count === 0 && !isSelected}
            onClick={() => onSelect(value)}
          >
            {names[value]}
            <span className="ml-1.5 tabular-nums opacity-60">{count}</span>
          </Chip>
        );
      })}
    </div>
  );
}

function Chip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-primary/40 bg-primary/10 text-foreground'
          : 'border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground',
        disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground',
      )}
    >
      {children}
    </button>
  );
}
