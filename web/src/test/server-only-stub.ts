/**
 * Stands in for the `server-only` package under vitest.
 *
 * The real package ships a client build whose only job is to throw on import, which is how a
 * server module leaking into a browser bundle becomes a build error. Vitest has no client bundle to
 * protect, so importing it there fails for a reason that has nothing to do with the test. Aliasing
 * it here (see `vitest.config.ts`) removes that, and removes nothing else: the guarantee is enforced
 * by the Next build, which does not use this file.
 */

export {};
