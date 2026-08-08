'use client';

/**
 * The last line of defence for a page that threw. Most commonly a session that expired mid-render,
 * so the sign-in route is offered alongside a retry.
 *
 * It sits above both route groups, so it also catches a signed-in shell that failed to build — which
 * is why it carries no chrome of its own and centres itself the way the sign-in surface does.
 */

import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-12">
      <Card>
        <CardContent className="pt-5">
          <h1 className="text-lg font-semibold tracking-tight">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
          <div className="mt-4 flex gap-2">
            <Button onClick={reset}>Try again</Button>
            <Button variant="outline" asChild>
              {/* Root-relative, not `./login`: this boundary catches pages at any depth, and a
                  relative href resolves against whichever one threw — from an article that is
                  `/nl/reading/login`, which is a valid article route and 404s. The middleware
                  puts the locale back on a bare `/login`.

                  A plain anchor rather than `<Link>`, which is what the rule below wants: the
                  render already failed here, so a full document load is the point — it rebuilds
                  the tree instead of navigating within the one that just threw. The same reason
                  `quiz-runner.tsx` reaches for `window.location.assign` on a lapsed session. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/login">Sign in</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
