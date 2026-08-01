/**
 * Sign in against identity-service.
 *
 * The form posts to a server action so credentials never touch client-side JavaScript, and the
 * token lands directly in an httpOnly cookie.
 *
 * In dev mode there is nothing to sign in to — the API is running with its stub principal — so the
 * page says so and offers a button that just sets the cookie.
 */

import { redirect } from 'next/navigation';
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

  /** Only same-origin paths, so `?next=` cannot be used to bounce someone off-site. */
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
    <div className="mx-auto max-w-sm py-12">
      <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>

      {AUTH_MODE === 'dev' ? (
        <form action={continueAsDev} className="card mt-6">
          <p className="text-muted">{t.devMode}</p>
          <button type="submit" className="btn-primary mt-4 w-full">
            {t.devContinue}
          </button>
        </form>
      ) : (
        <form action={authenticate} className="card mt-6 space-y-4">
          <p className="text-muted">{t.subtitle}</p>
          <input type="hidden" name="next" value={safeNext} />

          <div>
            <label htmlFor="email" className="block text-sm font-medium">
              {t.email}
            </label>
            <input id="email" name="email" type="email" autoComplete="username" required className="field mt-1" />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium">
              {t.password}
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="field mt-1"
            />
          </div>

          {message ? (
            <p className="text-sm text-bad" role="alert">
              {message}
            </p>
          ) : null}

          <button type="submit" className="btn-primary w-full">
            {t.submit}
          </button>
        </form>
      )}
    </div>
  );
}
