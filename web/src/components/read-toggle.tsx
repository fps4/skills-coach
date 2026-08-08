'use client';

/**
 * Marking an article read, and putting it back.
 *
 * Reversible, and deliberately not automatic. A surface that marks an article read when you scroll
 * to the bottom is guessing, and it guesses wrong for exactly the article you opened, skimmed and
 * meant to come back to. Read is a filter the learner controls, not a measurement of them.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BookOpenCheck, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { clientApi, isSessionExpired } from '@/lib/api-client';
import type { Dictionary } from '@/i18n/dictionaries';

export function ReadToggle({
  articleId,
  readAt,
  dictionary,
}: {
  articleId: string;
  readAt: string | null;
  dictionary: Dictionary;
}) {
  const t = dictionary.reading;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRead = readAt !== null;

  const toggle = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      // No `/api` prefix: `clientApi` adds the base itself, and the route handler behind it is what
      // turns the httpOnly cookie into an Authorization header.
      await clientApi(`/v1/reading/${articleId}/read`, { method: 'POST', body: { read: !isRead } });
      // The page is a server component, so the new state comes from the same place the old one did
      // — no second copy of "is this read" to fall out of step with the library's count.
      startTransition(() => router.refresh());
    } catch (failure) {
      setError(isSessionExpired(failure) ? dictionary.common.sessionExpired : dictionary.common.error);
    } finally {
      setSaving(false);
    }
  };

  const busy = saving || pending;

  return (
    <div className="space-y-2">
      <Button variant={isRead ? 'outline' : 'default'} onClick={toggle} disabled={busy}>
        {isRead ? <RotateCcw className="h-4 w-4" /> : <BookOpenCheck className="h-4 w-4" />}
        {busy ? t.marking : isRead ? t.markUnread : t.markRead}
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
