'use client';

/**
 * Adding your own words to the block you are practising (ADR-0012).
 *
 * A pack is the curriculum, but not everything worth learning arrives with one. A word added here
 * becomes an ordinary item in this block's word deck — same prompting, same tolerant matching, same
 * two-in-a-row — so there is nothing new to learn about how to practise it.
 *
 * Collapsed by default: the trainer's job is the word in front of you, and a form competing with it
 * would be the wrong thing on the screen. It opens when asked and closes itself once the word is in.
 */

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { clientApi, isSessionExpired } from '@/lib/api-client';
import type { Dictionary } from '@/i18n/dictionaries';
import type { LearnerTerm } from '@/lib/types';

interface Props {
  blockId: string;
  contentLanguage: string;
  translationLanguage: string;
  dictionary: Dictionary;
  /** Refresh the deck, so a new word joins the rotation without a reload. */
  onChanged: () => void;
  onSessionExpired: () => void;
}

export function OwnWords({ blockId, contentLanguage, translationLanguage, dictionary, onChanged, onSessionExpired }: Props) {
  const t = dictionary.drills;

  const [open, setOpen] = useState(false);
  const [mine, setMine] = useState<LearnerTerm[]>([]);
  const [term, setTerm] = useState('');
  const [translation, setTranslation] = useState('');
  const [example, setExample] = useState('');
  const [saving, setSaving] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback(
    (cause: unknown): void => {
      if (isSessionExpired(cause)) onSessionExpired();
      else setError(dictionary.common.error);
    },
    [dictionary.common.error, onSessionExpired],
  );

  const load = useCallback(async (): Promise<void> => {
    try {
      const { terms } = await clientApi<{ terms: LearnerTerm[] }>(`/v1/blocks/${blockId}/terms`);
      setMine(terms);
    } catch (cause) {
      fail(cause);
    }
  }, [blockId, fail]);

  // Only once opened — a learner who never uses this pays for nothing.
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!term.trim() || !translation.trim() || saving) return;

    setSaving(true);
    setError(null);
    try {
      await clientApi(`/v1/blocks/${blockId}/terms`, {
        method: 'POST',
        body: { term: term.trim(), translation: translation.trim(), example: example.trim() || undefined },
      });
      setTerm('');
      setTranslation('');
      setExample('');
      setAdded(true);
      await load();
      onChanged();
    } catch (cause) {
      fail(cause);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (drillItemId: string): Promise<void> => {
    if (!window.confirm(t.removeWordConfirm)) return;
    try {
      await clientApi(`/v1/terms/${drillItemId}`, { method: 'DELETE' });
      await load();
      onChanged();
    } catch (cause) {
      fail(cause);
    }
  };

  if (!open) {
    return (
      <div className="mt-6 border-t border-border pt-4">
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> {t.addWord}
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-6 border-t border-border pt-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{t.addWord}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t.addWordIntro}</p>
        </div>
        <Button variant="ghost" size="sm" aria-label={dictionary.common.hide} onClick={() => setOpen(false)}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <form className="mt-3 space-y-2" onSubmit={(event) => void submit(event)}>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            className="sm:flex-1"
            lang={contentLanguage}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={t.addWordTerm}
            aria-label={t.addWordTerm}
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              setAdded(false);
            }}
          />
          <Input
            className="sm:flex-1"
            lang={translationLanguage}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={t.addWordTranslation}
            aria-label={t.addWordTranslation}
            value={translation}
            onChange={(event) => {
              setTranslation(event.target.value);
              setAdded(false);
            }}
          />
        </div>
        <Input
          lang={contentLanguage}
          autoComplete="off"
          placeholder={t.addWordExample}
          aria-label={t.addWordExample}
          value={example}
          onChange={(event) => setExample(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={saving || !term.trim() || !translation.trim()}>
            {t.addWordSubmit}
          </Button>
          {added ? <span className="text-xs text-success">{t.addWordAdded}</span> : null}
          {error ? (
            <span className="text-xs text-destructive" role="alert">
              {error}
            </span>
          ) : null}
        </div>
      </form>

      {mine.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs text-muted-foreground">{t.yourWords}</p>
          <ul className="mt-2 space-y-1">
            {mine.map((entry) => (
              <li key={entry.drillItemId} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">
                  <span lang={contentLanguage}>{entry.payload.term}</span>
                  <span className="text-muted-foreground"> · </span>
                  <span lang={translationLanguage} className="text-muted-foreground">
                    {entry.payload.translation}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`${t.removeWord}: ${entry.payload.term}`}
                  onClick={() => void remove(entry.drillItemId)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
