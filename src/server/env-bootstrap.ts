import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// `@next/env` is a bundled CJS package whose export shape different ESM/CJS
// interop layers handle inconsistently — a named `import { loadEnvConfig }`
// fails under tsx (cjs-module-lexer can't statically see a getter attached
// inside a minified webpack-style bundle), and a default `import NextEnv`
// resolves under vitest's transform but not tsx's (confirmed: both were
// tried and each broke a different way in a different runtime). A real
// `require()`, via createRequire, is plain CommonJS with no interop
// ambiguity at all — module.exports.loadEnvConfig always just works.
const require = createRequire(import.meta.url);
const { loadEnvConfig } = require('@next/env') as typeof import('@next/env');

/**
 * Prisma Client's *runtime* resolves a relative SQLite `file:` URL against
 * its own query-engine's location (node_modules/.prisma/client/) — NOT
 * against prisma/schema.prisma's directory the way `prisma db push`/
 * `migrate` do. Confirmed directly, not assumed: once env loading moved
 * earlier in the startup sequence (server.ts), a relative DATABASE_URL
 * silently created and connected to an empty
 * node_modules/.prisma/client/dev.db (0 bytes, no tables) instead of the
 * real prisma/dev.db — every request 500'd with "table does not exist"
 * while the actual database, and QSLDDK inside it, sat untouched.
 *
 * Resolving to an absolute path here, once, before Prisma Client is ever
 * constructed, removes the ambiguity entirely rather than depending on
 * which of Prisma's two different resolution behaviors happens to apply in
 * a given runtime.
 */
export function resolveSqliteUrl(rawUrl: string, schemaDir: string): string {
  if (!rawUrl.startsWith('file:')) return rawUrl; // not sqlite (e.g. a postgres URL) — leave untouched
  const rawPath = rawUrl.slice('file:'.length);
  if (path.isAbsolute(rawPath)) return rawUrl;
  const absolute = path.resolve(schemaDir, rawPath);
  return `file:${absolute.split(path.sep).join('/')}`;
}

export class DatabaseNotReadyError extends Error {}

/**
 * Local-sqlite-only startup preflight: refuses to boot against a database
 * file that doesn't exist, or exists but has no `Room` table — either of
 * those is SQLite having silently created a fresh empty file rather than a
 * real error, so without this check the server "starts successfully" and
 * 500s on every single request instead of failing loudly where the cause is
 * obvious. Opens read-only — never creates, writes to, or migrates anything.
 */
export function assertSqliteDatabaseReady(resolvedUrl: string): void {
  if (!resolvedUrl.startsWith('file:')) return; // not sqlite — nothing to preflight
  const dbPath = resolvedUrl.slice('file:'.length);

  if (!existsSync(dbPath)) {
    throw new DatabaseNotReadyError(
      `DATABASE_URL points at "${dbPath}", which does not exist. Refusing to start — ` +
        `connecting would silently create an empty database instead of using the real one. ` +
        `If this is genuinely a fresh setup, run "npm run db:push" first.`,
    );
  }

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Room'`)
      .get();
    if (!row) {
      throw new DatabaseNotReadyError(
        `DATABASE_URL points at "${dbPath}", but it has no "Room" table. Refusing to start — ` +
          `this looks like an empty or wrong database, not the real one. ` +
          `If this is genuinely a fresh setup, run "npm run db:push" first.`,
      );
    }
  } finally {
    db.close();
  }
}

/**
 * Loads .env* (via Next's own loader — same precedence Next itself uses:
 * .env.$NODE_ENV.local > .env.local > .env.$NODE_ENV > .env, and a value
 * already in the real environment always wins over any file), resolves a
 * relative sqlite DATABASE_URL to an absolute path, and preflights it.
 * Throws (does not process.exit) — the caller decides how to fail, which is
 * what makes this testable without spawning a process.
 */
export function bootstrapEnv(projectDir: string): { databaseUrl: string } {
  // forceReload: true — @next/env otherwise memoizes the first call for the
  // process's whole lifetime, which is fine in production (this only ever
  // runs once) but would make repeated calls in tests (different temp
  // project dirs) silently return the first result.
  loadEnvConfig(projectDir, process.env.NODE_ENV !== 'production', console, true);

  const rawDatabaseUrl = process.env.DATABASE_URL;
  if (!rawDatabaseUrl) {
    throw new DatabaseNotReadyError(
      'DATABASE_URL is not set (checked .env.local, .env, and the real environment).',
    );
  }

  const resolvedDatabaseUrl = resolveSqliteUrl(rawDatabaseUrl, path.join(projectDir, 'prisma'));
  process.env.DATABASE_URL = resolvedDatabaseUrl;
  assertSqliteDatabaseReady(resolvedDatabaseUrl);

  return { databaseUrl: resolvedDatabaseUrl };
}
