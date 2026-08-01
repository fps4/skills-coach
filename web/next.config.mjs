/**
 * Next configuration.
 *
 * `standalone` output produces a self-contained server bundle for the container image.
 *
 * Note what is deliberately *absent*: a `rewrites()` proxy to the API. The learner's token lives in
 * an httpOnly cookie, so a rewrite could forward the request but not turn that cookie into the
 * `Authorization: Bearer` header the API requires. `app/api/[...path]/route.ts` does that instead —
 * a route handler that reads the cookie server-side and attaches the header. That also keeps the
 * proxy target a *runtime* value rather than one frozen at build time.
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
