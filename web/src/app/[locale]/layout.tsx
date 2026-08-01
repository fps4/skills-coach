/**
 * The locale layout: this is where `<html lang>` is set, and where the shell renders.
 *
 * `lang` here is the **interface** language. Pack content carries its own `lang` at the point it is
 * rendered (see `SectionView`), which is what keeps a Dutch passage announced as Dutch inside an
 * English interface — ADR-0005.
 */

import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { isLocale, LOCALES, type Locale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { SiteHeader } from '@/components/site-header';

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const dictionary = getDictionary(locale as Locale);

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="min-h-screen">
        <SiteHeader locale={locale as Locale} dictionary={dictionary} />
        <main className="mx-auto w-full max-w-5xl px-4 pb-24 pt-6 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
