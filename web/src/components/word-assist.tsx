'use client';

/**
 * Adding words with a coach's help (ADR-0023).
 *
 * The learner names a word — or pastes a list — and a coach fills in the card: translation, forms, an
 * example, synonyms, a note. The runtime generates none of it (ADR-0001); it holds the word until a
 * coach answers through `/coach/v1`, which may take a moment or a while. So this screen never makes
 * the learner wait on it: a word goes into "waiting", they carry on, and it comes back under "ready to
 * review" when it has been filled in.
 *
 * Nothing reaches the deck until the learner accepts it, and what they accept is what they see here —
 * every line can be unticked or corrected first.
 */

import { useCallback, useEffect, useState } from 'react';
import { Check, Clock, RotateCcw, Sparkles, Trash2, X } from 'lucide-react';

import { OwnWords } from './own-words';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { clientApi, isSessionExpired } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type { Dictionary } from '@/i18n/dictionaries';
import type { OptionalTermField, TermRequest } from '@/lib/types';

interface Props {
  blockId: string;
  contentLanguage: string;
  translationLanguage: string;
  dictionary: Dictionary;
}

/** How often to look again while a word is with the coach. Slow on purpose: nobody is watching it. */
const POLL_MS = 10_000;

export function WordAssist({ blockId, contentLanguage, translationLanguage, dictionary }: Props) {
  const t = dictionary.assist;
  const [requests, setRequests] = useState<TermRequest[] | null>(null);
  const [term, setTerm] = useState('');
  const [bulk, setBulk] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  const fail = useCallback(
    (cause: unknown): void => {
      if (isSessionExpired(cause)) setExpired(true);
      else setError(dictionary.common.error);
    },
    [dictionary.common.error],
  );

  const load = useCallback(async (): Promise<void> => {
    try {
      const { requests: loaded } = await clientApi<{ requests: TermRequest[] }>(`/v1/blocks/${blockId}/term-requests`);
      setRequests(loaded);
    } catch (cause) {
      fail(cause);
    }
  }, [blockId, fail]);

  useEffect(() => {
    void load();
  }, [load]);

  const waiting = requests?.filter((entry) => entry.status === 'requested') ?? [];
  const ready = requests?.filter((entry) => entry.status === 'suggested') ?? [];
  const added = requests?.filter((entry) => entry.status === 'added') ?? [];

  // Look again only while something is with the coach, and only while the tab is visible.
  useEffect(() => {
    if (waiting.length === 0) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [waiting.length, load]);

  const ask = async (terms: string[]): Promise<boolean> => {
    if (terms.every((entry) => !entry.trim()) || sending) return false;
    setSending(true);
    setError(null);
    try {
      await clientApi(`/v1/blocks/${blockId}/term-requests`, { method: 'POST', body: { terms } });
      await load();
      return true;
    } catch (cause) {
      fail(cause);
      return false;
    } finally {
      setSending(false);
    }
  };

  const act = async (path: string, method: 'POST' | 'DELETE', body?: unknown): Promise<void> => {
    setError(null);
    try {
      await clientApi(path, { method, body });
      await load();
    } catch (cause) {
      fail(cause);
    }
  };

  if (expired) {
    return (
      <Card>
        <CardContent className="pt-5 text-sm">{dictionary.common.sessionExpired}</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="space-y-3 pt-5">
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              void ask([term]).then((ok) => (ok ? setTerm('') : undefined));
            }}
          >
            <label htmlFor="assist-term" className="text-sm font-medium text-muted-foreground">
              {t.wordLabel}
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="assist-term"
                lang={contentLanguage}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder={t.placeholder}
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                className="h-11 text-base sm:flex-1"
              />
              <Button type="submit" className="h-11" disabled={sending || !term.trim()}>
                <Sparkles className="h-4 w-4" />
                {t.fill}
              </Button>
            </div>
          </form>
          <p className="text-sm text-muted-foreground">{t.fillIntro}</p>

          <details className="group">
            <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">{t.bulk}</summary>
            <div className="mt-2 space-y-2">
              <Textarea
                lang={contentLanguage}
                aria-label={t.bulk}
                placeholder={t.bulkPlaceholder}
                rows={4}
                value={bulk}
                onChange={(event) => setBulk(event.target.value)}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={sending || !bulk.trim()}
                onClick={() => void ask(bulk.split('\n')).then((ok) => (ok ? setBulk('') : undefined))}
              >
                {t.bulkSend}
              </Button>
            </div>
          </details>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {ready.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">
            {t.ready} <span className="font-normal text-muted-foreground">· {ready.length}</span>
          </h2>
          <p className="text-sm text-muted-foreground">{t.reviewIntro}</p>
          {ready.map((request) => (
            <ReviewCard
              key={request.requestId}
              request={request}
              contentLanguage={contentLanguage}
              translationLanguage={translationLanguage}
              dictionary={dictionary}
              onAccept={(body) => act(`/v1/term-requests/${request.requestId}/accept`, 'POST', body)}
              onRetry={() => act(`/v1/term-requests/${request.requestId}/retry`, 'POST')}
              onDiscard={() => act(`/v1/term-requests/${request.requestId}`, 'DELETE')}
            />
          ))}
        </section>
      ) : null}

      {waiting.length > 0 ? (
        <section>
          <h2 className="text-sm font-semibold">
            {t.waiting} <span className="font-normal text-muted-foreground">· {waiting.length}</span>
          </h2>
          <ul className="mt-2 divide-y divide-border/60 rounded-md border border-border">
            {waiting.map((request) => (
              <li key={request.requestId} className="flex items-center gap-2 px-3 py-2 text-sm">
                <Clock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate" lang={contentLanguage}>
                  {request.term}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`${t.discard}: ${request.term}`}
                  onClick={() => void act(`/v1/term-requests/${request.requestId}`, 'DELETE')}
                >
                  <X className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {added.length > 0 ? (
        <section>
          <h2 className="text-sm font-semibold">
            {t.added} <span className="font-normal text-muted-foreground">· {added.length}</span>
          </h2>
          <ul className="mt-2 space-y-1">
            {added.map((request) => (
              <li key={request.requestId} className="flex items-center gap-2 text-sm text-muted-foreground">
                <Check className="h-4 w-4 shrink-0 text-success" aria-hidden />
                <span lang={contentLanguage}>{request.term}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {requests && requests.length === 0 ? <p className="text-sm text-muted-foreground">{t.nothingYet}</p> : null}

      {/* Typing a card in by hand is still there, for the word the learner already knows all about. */}
      <OwnWords
        blockId={blockId}
        contentLanguage={contentLanguage}
        translationLanguage={translationLanguage}
        dictionary={dictionary}
        onChanged={() => undefined}
        onSessionExpired={() => setExpired(true)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// One suggestion, as the learner checks it
// ---------------------------------------------------------------------------

interface AcceptBody {
  translation: string;
  example: string;
  details: {
    partOfSpeech: string;
    forms: { label: string; value: string }[];
    exampleTranslation: string;
    synonyms: string[];
    antonyms: string[];
    note: string;
  };
  omit: OptionalTermField[];
}

const splitList = (value: string): string[] =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

/** "past: verdween, verdwenen" per line; a line without a colon is a form with no label. */
const parseForms = (value: string): { label: string; value: string }[] =>
  value
    .split('\n')
    .map((line) => {
      const at = line.indexOf(':');
      return at < 0 ? { label: '', value: line.trim() } : { label: line.slice(0, at).trim(), value: line.slice(at + 1).trim() };
    })
    .filter((form) => form.value);

function ReviewCard({
  request,
  contentLanguage,
  translationLanguage,
  dictionary,
  onAccept,
  onRetry,
  onDiscard,
}: {
  request: TermRequest;
  contentLanguage: string;
  translationLanguage: string;
  dictionary: Dictionary;
  onAccept: (body: AcceptBody) => Promise<void>;
  onRetry: () => Promise<void>;
  onDiscard: () => Promise<void>;
}) {
  const t = dictionary.assist;
  const suggestion = request.suggestion ?? { translation: '' };
  const details = suggestion.details ?? {};

  const [values, setValues] = useState({
    translation: suggestion.translation,
    partOfSpeech: details.partOfSpeech ?? '',
    forms: (details.forms ?? []).map((form) => (form.label ? `${form.label}: ${form.value}` : form.value)).join('\n'),
    example: suggestion.example ?? '',
    exampleTranslation: details.exampleTranslation ?? '',
    synonyms: (details.synonyms ?? []).join(', '),
    antonyms: (details.antonyms ?? []).join(', '),
    note: details.note ?? '',
  });
  const [omit, setOmit] = useState<Set<OptionalTermField>>(new Set());
  const [busy, setBusy] = useState(false);

  const set = (field: keyof typeof values) => (value: string) => setValues((previous) => ({ ...previous, [field]: value }));
  const toggle = (field: OptionalTermField) =>
    setOmit((previous) => {
      const next = new Set(previous);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const accept = () =>
    run(() =>
      onAccept({
        translation: values.translation,
        example: values.example,
        details: {
          partOfSpeech: values.partOfSpeech,
          forms: parseForms(values.forms),
          exampleTranslation: values.exampleTranslation,
          synonyms: splitList(values.synonyms),
          antonyms: splitList(values.antonyms),
          note: values.note,
        },
        omit: [...omit],
      }),
    );

  // Only the lines the coach filled in, or the learner has since: an empty row is noise on a card.
  const row = (
    field: OptionalTermField,
    label: string,
    value: string,
    lang: string,
    options: { multiline?: boolean; hint?: string } = {},
  ) => {
    if (!value && !(field in details) && field !== 'example') return null;
    if (field === 'example' && !suggestion.example && !value) return null;
    const off = omit.has(field);
    const id = `${request.requestId}-${field}`;
    const Control = options.multiline ? Textarea : Input;

    return (
      <div
        key={field}
        className="grid grid-cols-[1.25rem_7rem_minmax(0,1fr)] items-start gap-3 border-t border-border/60 px-4 py-3"
      >
        <input
          type="checkbox"
          checked={!off}
          onChange={() => toggle(field)}
          aria-label={`${t.include}: ${label}`}
          className="mt-2.5 h-4 w-4 accent-[hsl(var(--primary))]"
        />
        <label htmlFor={id} className="pt-2 text-xs font-medium text-muted-foreground">
          {label}
        </label>
        <div className={cn(off && 'opacity-40')}>
          <Control
            id={id}
            lang={lang}
            value={value}
            disabled={off}
            onChange={(event: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) =>
              set(field as keyof typeof values)(event.target.value)
            }
            {...(options.multiline ? { rows: Math.max(2, value.split('\n').length) } : {})}
            className="min-h-0"
          />
          {options.hint ? <p className="mt-1 text-xs text-muted-foreground">{options.hint}</p> : null}
        </div>
      </div>
    );
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 bg-muted/40 px-4 py-3">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{t.youPractise}</span>
        <span className="text-lg font-semibold" lang={contentLanguage}>
          {request.term}
        </span>
        <span aria-hidden className="text-muted-foreground">
          ⇄
        </span>
        <span className="text-lg font-medium text-primary" lang={translationLanguage}>
          {values.translation || '…'}
        </span>
      </div>

      <div className="grid grid-cols-[1.25rem_7rem_minmax(0,1fr)] items-start gap-3 px-4 py-3">
        <Check className="mt-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
        <label htmlFor={`${request.requestId}-translation`} className="pt-2 text-xs font-medium text-muted-foreground">
          {t.translation}
        </label>
        <Input
          id={`${request.requestId}-translation`}
          lang={translationLanguage}
          value={values.translation}
          onChange={(event) => set('translation')(event.target.value)}
        />
      </div>
      {row('partOfSpeech', t.partOfSpeech, values.partOfSpeech, translationLanguage)}
      {row('forms', t.forms, values.forms, contentLanguage, { multiline: true, hint: t.formsHint })}
      {row('example', t.example, values.example, contentLanguage)}
      {omit.has('example')
        ? null
        : row('exampleTranslation', t.exampleTranslation, values.exampleTranslation, translationLanguage)}
      {row('synonyms', t.synonyms, values.synonyms, contentLanguage, { hint: t.listHint })}
      {row('antonyms', t.antonyms, values.antonyms, contentLanguage, { hint: t.listHint })}
      {row('note', t.note, values.note, translationLanguage, { multiline: true })}

      <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
        <Button disabled={busy || !values.translation.trim()} onClick={() => void accept()}>
          <Check className="h-4 w-4" />
          {t.addToDeck}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void run(onRetry)}>
          <RotateCcw className="h-4 w-4" />
          {t.askAgain}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => void run(onDiscard)}>
          <Trash2 className="h-4 w-4" />
          {t.discard}
        </Button>
      </div>
    </Card>
  );
}
