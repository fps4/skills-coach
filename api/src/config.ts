/**
 * Configuration, validated once at boot.
 *
 * A misconfigured deployment should fail loudly on startup rather than at the first request that
 * happens to need the missing value — so anything required in production is checked here.
 */

import { z } from 'zod';

const envSchema = z.object({
  COACH_ENV: z.enum(['local', 'test', 'production']).default('local'),
  NODE_ENV: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(8000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  MONGO_URI: z.string().default('mongodb://localhost:27018'),
  MONGO_DB: z.string().default('skills-coach'),
  /**
   * Credentials are supplied separately rather than embedded in the URI.
   *
   * Building `mongodb://user:pass@host` by string concatenation means every character that is
   * special in a URI (`@ : / ? #`) has to be percent-encoded by hand, and getting that wrong
   * surfaces as "Authentication failed" — which reads like a wrong password rather than a
   * malformed URI. Handing the driver the raw values removes the encoding step entirely.
   */
  MONGO_USER: z.string().optional(),
  MONGO_PASSWORD: z.string().optional(),
  MONGO_AUTH_SOURCE: z.string().default('admin'),

  /**
   * `dev` injects a fixed stub principal instead of verifying a token, so a contributor can run
   * the stack without an identity provider. Refused in production — see `assertSafe` below.
   */
  AUTH_MODE: z.enum(['dev', 'jwks']).default('dev'),
  AUTH_JWKS_URL: z.string().url().optional(),
  AUTH_ISSUER: z.string().optional(),
  /**
   * Comma-separated, because one product can be more than one OAuth *resource*. A token minted for
   * the MCP endpoint carries that endpoint's URL as its `aud` (RFC 8707), not the application's, and
   * both are this service.
   */
  AUTH_AUDIENCE: z.string().optional(),
  /** Clock skew tolerated when checking `exp`/`nbf`. */
  AUTH_CLOCK_TOLERANCE_SECONDS: z.coerce.number().int().nonnegative().default(30),

  /**
   * The canonical, public URL of the MCP endpoint — and the switch that turns it on.
   *
   * Configured, never derived from the `Host` header: it is published in a discovery document and
   * checked as a token audience, and a spoofable input has no business in either. Unset means this
   * deployment serves no MCP resource and advertises none.
   */
  MCP_RESOURCE_URL: z.string().url().optional(),

  /** Comma-separated. Empty means same-origin only, which is the deployed shape. */
  CORS_ORIGINS: z.string().default(''),

  AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().default(365),
});

export type Environment = z.infer<typeof envSchema>['COACH_ENV'];

export interface AuthConfig {
  mode: 'dev' | 'jwks';
  jwksUrl?: string;
  issuer?: string;
  /** Every audience this service answers to. A token matching any one of them verifies. */
  audiences: string[];
  clockToleranceSeconds: number;
}

export interface McpConfig {
  /** Absent when this deployment exposes no MCP endpoint. Presence is what enables it. */
  resourceUrl?: string;
}

export interface MongoCredentials {
  username: string;
  password: string;
  authSource: string;
}

export interface Config {
  env: Environment;
  port: number;
  host: string;
  logLevel: string;
  mongoUri: string;
  mongoDb: string;
  /** Absent when the deployment runs an unauthenticated MongoDB, as local development does. */
  mongoCredentials?: MongoCredentials;
  auth: AuthConfig;
  mcp: McpConfig;
  corsOrigins: string[];
  auditRetentionDays: number;
}

export class ConfigError extends Error {}

/**
 * An unset variable and an empty one mean the same thing here.
 *
 * Compose interpolates `${AUTH_JWKS_URL:-}` to an empty string rather than omitting the variable,
 * so without this every optional setting arrives as `''` — which fails validation instead of
 * falling back to its default. Dropping empties makes "not configured" a single case.
 */
/** A comma-separated setting, trimmed, with the empties dropped. */
function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function withoutEmpty(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const cleaned: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string' && value.trim() === '') continue;
    cleaned[key] = value;
  }
  return cleaned;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(withoutEmpty(source));
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new ConfigError(`invalid configuration — ${detail}`);
  }
  const env = parsed.data;

  const config: Config = {
    env: env.COACH_ENV,
    port: env.PORT,
    host: env.HOST,
    logLevel: env.LOG_LEVEL,
    mongoUri: env.MONGO_URI,
    mongoDb: env.MONGO_DB,
    mongoCredentials:
      env.MONGO_USER && env.MONGO_PASSWORD
        ? { username: env.MONGO_USER, password: env.MONGO_PASSWORD, authSource: env.MONGO_AUTH_SOURCE }
        : undefined,
    auth: {
      mode: env.AUTH_MODE,
      jwksUrl: env.AUTH_JWKS_URL,
      issuer: env.AUTH_ISSUER,
      // The MCP resource is appended rather than configured twice: the URL published in the
      // discovery document and the audience accepted from a token are the same fact, and two
      // settings for one fact drift.
      audiences: [...list(env.AUTH_AUDIENCE), ...(env.MCP_RESOURCE_URL ? [env.MCP_RESOURCE_URL] : [])],
      clockToleranceSeconds: env.AUTH_CLOCK_TOLERANCE_SECONDS,
    },
    mcp: { resourceUrl: env.MCP_RESOURCE_URL },
    corsOrigins: env.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    auditRetentionDays: env.AUDIT_RETENTION_DAYS,
  };

  assertSafe(config, env.NODE_ENV);
  return config;
}

/**
 * The checks that stop a deployment running with development shortcuts enabled.
 *
 * `COACH_ENV` is the deployment signal, and deliberately the *only* one consulted. `NODE_ENV` is
 * not: the runtime image sets it to `production` unconditionally, because that is what it means to
 * Node and to the libraries — it says nothing about whether this is a deployment. Treating it as a
 * second signal would refuse the stub principal in the supported "run the containers locally" case,
 * which is a false positive that teaches people to work around the check.
 */
function assertSafe(config: Config, _nodeEnv: string | undefined): void {
  const isProduction = config.env === 'production';

  if (config.auth.mode === 'dev' && isProduction) {
    throw new ConfigError('AUTH_MODE=dev is refused in production — set AUTH_MODE=jwks and configure the verifier');
  }

  if (config.auth.mode === 'jwks') {
    const missing: string[] = [];
    if (!config.auth.jwksUrl) missing.push('AUTH_JWKS_URL');
    if (!config.auth.issuer) missing.push('AUTH_ISSUER');
    if (config.auth.audiences.length === 0) missing.push('AUTH_AUDIENCE');
    if (missing.length > 0) {
      throw new ConfigError(`AUTH_MODE=jwks requires ${missing.join(', ')}`);
    }
  }

  // An MCP resource is only meaningful behind a real verifier: the endpoint's whole authorization
  // story is a token bound to that URL, and `dev` mode verifies nothing.
  if (config.mcp.resourceUrl && config.auth.mode === 'dev' && isProduction) {
    throw new ConfigError('MCP_RESOURCE_URL requires AUTH_MODE=jwks in production');
  }
}
