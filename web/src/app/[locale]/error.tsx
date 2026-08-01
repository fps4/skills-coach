'use client';

/**
 * The last line of defence for a page that threw. Most commonly a session that expired mid-render,
 * so the sign-in route is offered alongside a retry.
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
    <div className="mx-auto w-full max-w-md px-6 py-16">
      <Card>
        <CardContent className="pt-5">
          <h1 className="text-lg font-semibold tracking-tight">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
          <div className="mt-4 flex gap-2">
            <Button onClick={reset}>Try again</Button>
            <Button variant="outline" asChild>
              <a href="./login">Sign in</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
