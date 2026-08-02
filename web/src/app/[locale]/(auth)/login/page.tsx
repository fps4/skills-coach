/**
 * Sign in against identity-service.
 *
 * The form posts to a server action, so credentials never touch client-side JavaScript and the
 * token lands directly in an httpOnly cookie.
 *
 * In dev mode there is nothing to sign in to — the API runs with its stub principal — so the page
 * says so rather than showing a form that cannot work. Both branches are the same card with the
 * same heading; only what sits under it differs.
 */

import { redirect } from 'next/navigation';
import { LogIn } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { getDictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';
import { AUTH_MODE, DEV_TOKEN } from '@/lib/session';
import { setSession, signIn, SignInError } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { locale } = await params;
  const { next, error } = await searchParams;
  const dictionary = getDictionary(locale);
  const t = dictionary.login;

  /** Only same-origin paths, so `?next=` cannot bounce someone off-site. */
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : `/${locale}`;

  async function authenticate(formData: FormData): Promise<void> {
    'use server';

    const email = String(formData.get('email') ?? '');
    const password = String(formData.get('password') ?? '');
    const target = String(formData.get('next') ?? `/${locale}`);

    try {
      await setSession(await signIn(email, password));
    } catch (cause) {
      const reason = cause instanceof SignInError ? cause.reason : 'credentials';
      redirect(`/${locale}/login?error=${reason}&next=${encodeURIComponent(target)}`);
    }
    redirect(target);
  }

  async function continueAsDev(): Promise<void> {
    'use server';
    await setSession({ accessToken: DEV_TOKEN });
    redirect(`/${locale}`);
  }

  const message = error === 'unavailable' || error === 'not-configured' ? t.unavailable : error ? t.failed : null;

  return (
    <Card>
      <CardHeader>
        <h1 className="text-lg font-semibold tracking-tight">{t.title}</h1>
        <p className="text-sm text-muted-foreground">{AUTH_MODE === 'dev' ? t.devMode : t.subtitle}</p>
      </CardHeader>

      <CardContent>
        {AUTH_MODE === 'dev' ? (
          <form action={continueAsDev}>
            <Button type="submit" className="w-full">
              {t.devContinue}
            </Button>
          </form>
        ) : (
          <form action={authenticate} className="space-y-4">
            <input type="hidden" name="next" value={safeNext} />

            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-sm font-medium">
                {t.email}
              </label>
              <Input id="email" name="email" type="email" autoComplete="username" autoFocus required />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="block text-sm font-medium">
                {t.password}
              </label>
              <Input id="password" name="password" type="password" autoComplete="current-password" required />
            </div>

            {message ? (
              <p className="text-sm text-destructive" role="alert">
                {message}
              </p>
            ) : null}

            <Button type="submit" className="w-full">
              <LogIn className="h-4 w-4" /> {t.submit}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
