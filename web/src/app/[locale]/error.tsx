'use client';

/**
 * The last line of defence for a page that threw. Most commonly this is a session that expired
 * mid-render, so the sign-in route is offered rather than only a retry.
 */

import { useEffect } from 'react';

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return (
    <div className="card mx-auto mt-12 max-w-md">
      <h1 className="text-lg font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted">{error.message}</p>
      <div className="mt-4 flex gap-2">
        <button type="button" className="btn-primary" onClick={reset}>
          Try again
        </button>
        <a href="./login" className="btn-secondary">
          Sign in
        </a>
      </div>
    </div>
  );
}
