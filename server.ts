/**
 * Bootstrap only. Everything in this file must finish — env loaded, a
 * database ready to use — before `./server-main` is ever imported.
 *
 * That import below is deliberately *dynamic* (`await import(...)`), not a
 * static one: ES module imports are hoisted above every other statement in
 * a file, including ones placed textually before them, so a static
 * `import { startServer } from './server-main'` here would still run before
 * any of the code below it — server-main.ts pulls in `@/server/socket` →
 * `@/lib/db`, which constructs `new PrismaClient()` at module scope, and
 * that construction needs to happen strictly after this file's own env
 * setup, not race it.
 *
 * This isn't theoretical — it's the exact sequence of two real, reproduced
 * bugs this file exists to prevent:
 *   1. DATABASE_URL wasn't loaded before PrismaClient's first query, which
 *      failed with "Environment variable not found: DATABASE_URL" and did
 *      not self-heal even after the var later appeared (Prisma resolves the
 *      datasource once, not per-query).
 *   2. Loading env earlier (via a CLI flag) fixed #1 but changed *how*
 *      DATABASE_URL entered process.env, which exposed a second, unrelated
 *      bug: Prisma Client's runtime resolves a relative sqlite `file:` URL
 *      against its own query-engine location
 *      (node_modules/.prisma/client/), not against prisma/schema.prisma's
 *      directory — so it silently connected to a fresh, empty database
 *      instead of the real one. Every request 500'd with "table does not
 *      exist" while the real database sat untouched.
 * `bootstrapEnv` (src/server/env-bootstrap.ts) resolves DATABASE_URL to an
 * absolute path and preflights it before either bug can happen again,
 * regardless of which loader or ordering quirk is involved.
 */
import { bootstrapEnv, DatabaseNotReadyError } from '@/server/env-bootstrap';

try {
  // Same assumption Next itself makes (next({dev, hostname, port}) also
  // defaults to cwd) — both npm scripts already invoke this from the
  // project root (package.json's "dev"/"start" run "tsx ... server.ts").
  bootstrapEnv(process.cwd());
} catch (err) {
  if (err instanceof DatabaseNotReadyError) {
    console.error('[startup]', err.message);
  } else {
    console.error('[startup] failed to load environment:', err);
  }
  process.exit(1);
}

async function main() {
  const { startServer } = await import('./server-main');
  await startServer();
}

main().catch((err) => {
  console.error('[server] failed to start:', err);
  process.exit(1);
});
