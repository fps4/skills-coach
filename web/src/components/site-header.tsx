import Link from 'next/link';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { LanguageSwitch } from './language-switch';

export function SiteHeader({ locale, dictionary }: { locale: Locale; dictionary: Dictionary }) {
  const links = [
    { href: `/${locale}`, label: dictionary.nav.home },
    { href: `/${locale}/progress`, label: dictionary.nav.progress },
  ];

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link href={`/${locale}`} className="font-semibold tracking-tight">
          {dictionary.appName}
        </Link>

        <nav className="flex items-center gap-4 text-sm">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="text-muted transition hover:text-ink">
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto">
          <LanguageSwitch locale={locale} label={dictionary.nav.language} />
        </div>
      </div>
    </header>
  );
}
