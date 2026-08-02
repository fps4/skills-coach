/**
 * Sign out.
 *
 * A form posting to a server action, not a link: the session cookie is httpOnly, so only the server
 * can clear it — and a GET that ends a session would fire on any prefetch or link scanner.
 *
 * In dev mode this still does the honest thing. It drops the cookie and lands on the sign-in screen,
 * which then offers to continue without credentials, because that is what dev mode is.
 */

import { LogOut } from 'lucide-react';
import { redirect } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { clearSession } from '@/lib/auth';
import type { Locale } from '@/i18n/config';

export function SignOut({ locale, label }: { locale: Locale; label: string }) {
  async function signOut(): Promise<void> {
    'use server';
    await clearSession();
    redirect(`/${locale}/login`);
  }

  return (
    <form action={signOut}>
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        title={label}
        aria-label={label}
        className="text-muted-foreground hover:text-foreground"
      >
        <LogOut className="h-4 w-4" />
        {/* Named where there is room: the other header controls are conventional icons, this one
            is the control people go looking for by name. */}
        <span className="hidden sm:inline">{label}</span>
      </Button>
    </form>
  );
}
