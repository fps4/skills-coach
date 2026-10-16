'use client';

/**
 * The search bar in the header (ADR-0030).
 *
 * Asks the api as the learner types — debounced, from the second character — and shows the best
 * results in a popover grouped into guides and cards. The arrow keys walk the results and Enter opens
 * one; Enter with nothing chosen opens the full results page. `/` or ⌘K / Ctrl-K reach the bar from
 * anywhere on the page (see `focusesSearch` for why that cannot collide with the flashcards' keys).
 *
 * A stale answer never overwrites a newer one: each request is aborted when the query moves on.
 */

import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { SearchResultBody } from '@/components/search-result';
import type { Dictionary } from '@/i18n/dictionaries';
import { clientApi, isSessionExpired, query as queryString } from '@/lib/api-client';
import {
  MIN_QUERY_LENGTH,
  SUGGESTION_LIMIT,
  focusesSearch,
  groupHits,
  hitHref,
  searchHref,
  type SearchResponse,
} from '@/lib/search';
import { cn } from '@/lib/utils';

const DEBOUNCE_MS = 150;

export function SearchBar({ dictionary }: { dictionary: Dictionary }) {
  const t = dictionary.search;
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const [q, setQ] = useState('');
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const trimmed = q.trim();
  const groups = useMemo(() => groupHits(response?.hits ?? []), [response]);
  /** The order the arrow keys walk: every result, then "see all". */
  const targets = useMemo(
    () => [...groups.flatMap((group) => group.hits.map(hitHref)), ...(trimmed ? [searchHref(trimmed)] : [])],
    [groups, trimmed],
  );

  useEffect(() => {
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResponse(null);
      setFailure(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      clientApi<SearchResponse>(`/v1/search${queryString({ q: trimmed, limit: SUGGESTION_LIMIT })}`)
        .then((result) => {
          if (controller.signal.aborted) return;
          setResponse(result);
          setFailure(null);
          setActive(-1);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setFailure(isSessionExpired(error) ? dictionary.common.sessionExpired : dictionary.common.error);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [trimmed, dictionary.common.error, dictionary.common.sessionExpired]);

  // `/` and ⌘K from anywhere. Bound once; the handler reads nothing that changes.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!focusesSearch(event)) return;
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      setActive(-1);
      inputRef.current?.blur();
      router.push(href);
    },
    [router],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setOpen(true);
        setActive((index) => (targets.length === 0 ? -1 : (index + 1) % targets.length));
        return;
      case 'ArrowUp':
        event.preventDefault();
        setActive((index) => (targets.length === 0 ? -1 : index <= 0 ? targets.length - 1 : index - 1));
        return;
      case 'Enter': {
        event.preventDefault();
        const chosen = active >= 0 ? targets[active] : undefined;
        if (chosen) go(chosen);
        else if (trimmed.length >= MIN_QUERY_LENGTH) go(searchHref(trimmed));
        return;
      }
      case 'Escape':
        event.preventDefault();
        if (open) setOpen(false);
        else event.currentTarget.blur();
        return;
    }
  };

  const showPopover = open && trimmed.length >= MIN_QUERY_LENGTH && (response !== null || failure !== null);
  const optionId = (index: number) => `${listId}-option-${index}`;
  let index = -1;

  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" aria-hidden />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label={t.label}
        aria-expanded={showPopover}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showPopover && active >= 0 ? optionId(active) : undefined}
        aria-keyshortcuts="/ Meta+K Control+K"
        title={t.shortcut}
        placeholder={t.placeholder}
        value={q}
        onChange={(event) => {
          setQ(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className="h-8 w-full min-w-0 rounded-md border border-border bg-background pl-8 pr-8 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-search-cancel-button]:hidden"
      />
      <kbd className="pointer-events-none absolute right-2 top-1.5 hidden rounded border border-border px-1.5 text-[11px] leading-4 text-muted-foreground sm:block">
        /
      </kbd>

      {showPopover ? (
        <div
          id={listId}
          role="listbox"
          aria-label={t.label}
          // Pressing on a result must not blur the input first, or the popover closes under the click.
          onMouseDown={(event) => event.preventDefault()}
          className="fixed inset-x-3 top-14 z-30 max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-card p-1.5 shadow-lg sm:absolute sm:inset-x-auto sm:left-0 sm:top-full sm:mt-2 sm:w-[min(36rem,calc(100vw-2rem))]"
        >
          {failure ? (
            <p className="px-3 py-2 text-sm text-destructive">{failure}</p>
          ) : groups.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              {loading ? t.searching : t.noResults.replace('{q}', trimmed)}
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.kind} role="group" aria-label={group.kind === 'guide' ? t.guides : t.cards}>
                <p className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {group.kind === 'guide' ? t.guides : t.cards}
                </p>
                {group.hits.map((hit) => {
                  index += 1;
                  const position = index;
                  return (
                    <div
                      key={`${hit.kind}:${hit.drillItemId ?? `${hit.slug}#${hit.anchor ?? ''}`}`}
                      id={optionId(position)}
                      role="option"
                      aria-selected={active === position}
                      onMouseEnter={() => setActive(position)}
                      onClick={() => go(hitHref(hit))}
                      className={cn(
                        'cursor-pointer rounded-md px-3 py-2',
                        active === position ? 'bg-muted' : 'hover:bg-muted/60',
                      )}
                    >
                      <SearchResultBody hit={hit} compact />
                    </div>
                  );
                })}
              </div>
            ))
          )}
          {!failure && trimmed ? (
            <div
              id={optionId(targets.length - 1)}
              role="option"
              aria-selected={active === targets.length - 1}
              onMouseEnter={() => setActive(targets.length - 1)}
              onClick={() => go(searchHref(trimmed))}
              className={cn(
                'mt-1 cursor-pointer rounded-md border-t border-border px-3 py-2 text-sm text-primary',
                active === targets.length - 1 ? 'bg-muted' : 'hover:bg-muted/60',
              )}
            >
              {t.seeAll}
              {response && response.total > 0 ? ` (${response.total})` : ''}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
