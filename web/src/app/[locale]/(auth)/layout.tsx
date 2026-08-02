/**
 * The public surface: everything reachable without a session.
 *
 * One column, vertically centred, nothing around it. No header link and no rail — both would point
 * at pages the visitor cannot open yet, and the middleware would bounce them straight back. The two
 * controls that do work before signing in stay: the interface language, and light/dark.
 */

import type { ReactNode } from 'react';

import { LanguageSwitch } from '@/components/language-switch';
import { ThemeToggle } from '@/components/theme-toggle';
import type { Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';

export default async function AuthLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  // Narrowing is safe here: the locale layout above has already sent anything else to `notFound()`.
  const { locale } = (await params) as { locale: Locale };
  const dictionary = getDictionary(locale);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-6 py-12">
      <div className="text-center">
        <p className="text-lg font-bold tracking-tight">
          Skills <span className="text-primary">Coach</span>
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{dictionary.chrome.tagline}</p>
      </div>

      {children}

      <div className="flex items-center justify-center gap-1">
        <LanguageSwitch locale={locale} label={dictionary.nav.language} />
        <ThemeToggle label={dictionary.chrome.theme} />
      </div>
    </main>
  );
}
