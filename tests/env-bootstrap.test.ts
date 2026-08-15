import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertSqliteDatabaseReady,
  bootstrapEnv,
  DatabaseNotReadyError,
  resolveSqliteUrl,
} from '@/server/env-bootstrap';

/**
 * Regression coverage for a real incident, not a hypothetical one: fixing
 * the DATABASE_URL-not-loaded-yet race (server.ts's original bug) by moving
 * env loading earlier exposed a second, independent bug — Prisma Client's
 * runtime resolves a relative sqlite `file:` URL against its own
 * query-engine's install location, not against prisma/schema.prisma's
 * directory. The live server 500'd on every request ("table does not
 * exist") because it had silently connected to a fresh, empty
 * node_modules/.prisma/client/dev.db instead of the real database — found
 * via read-only forensics (enumerating every .db file, inspecting
 * sqlite_master), not assumed.
 *
 * Every fixture database here is a temp copy or a freshly-created empty
 * file — this suite never opens, imports, or otherwise touches the real
 * prisma/dev.db (which has room QSLDDK in it).
 */

const realDbPath = path.resolve(__dirname, '..', 'prisma', 'dev.db');

let tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'memeback-env-bootstrap-'));
  tempDirs.push(dir);
  return dir;
}

/** @next/env's types declare NODE_ENV readonly on NodeJS.ProcessEnv — true
 *  for typical app code, but these tests deliberately flip it per-case to
 *  exercise dev/production .env precedence. */
function setNodeEnv(value: string) {
  (process.env as Record<string, string>).NODE_ENV = value;
}

/** Matches the real project's layout: DATABASE_URL's relative "./x.db" is
 *  resolved against prisma/schema.prisma's directory, so a fixture project
 *  dir needs its .db files inside <dir>/prisma/, not at its root. */
function seedFixtureDb(dir: string, name: string): string {
  const schemaDir = path.join(dir, 'prisma');
  mkdirSync(schemaDir, { recursive: true });
  const target = path.join(schemaDir, name);
  copyFileSync(realDbPath, target);
  return target;
}

function toFileUrl(absolutePath: string): string {
  return `file:${absolutePath.split(path.sep).join('/')}`;
}

const savedEnv = { ...process.env };

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
  // bootstrapEnv mutates process.env for real — restore between tests so one
  // test's fixture values can never leak into the next.
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
});

describe('resolveSqliteUrl', () => {
  it("resolves a relative path against the schema directory, never the caller's cwd", () => {
    const originalCwd = process.cwd();
    try {
      process.chdir(tmpdir());
      const resolved = resolveSqliteUrl('file:./dev.db', 'D:/SomeProject/prisma');
      expect(resolved).toBe('file:D:/SomeProject/prisma/dev.db');
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('gives the identical result regardless of which directory the process happens to be running from', () => {
    const originalCwd = process.cwd();
    const fromHere = resolveSqliteUrl('file:./dev.db', 'C:/Project/prisma');
    try {
      process.chdir(tmpdir());
      const fromThere = resolveSqliteUrl('file:./dev.db', 'C:/Project/prisma');
      expect(fromThere).toBe(fromHere);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('leaves an already-absolute path untouched', () => {
    expect(resolveSqliteUrl('file:D:/elsewhere/x.db', 'D:/proj/prisma')).toBe('file:D:/elsewhere/x.db');
  });

  it('leaves a non-sqlite URL untouched (e.g. a future Postgres migration)', () => {
    const pg = 'postgresql://user:pass@host:5432/db';
    expect(resolveSqliteUrl(pg, 'D:/proj/prisma')).toBe(pg);
  });
});

describe('assertSqliteDatabaseReady', () => {
  it('passes for a real database with a Room table (a temp copy — never the live file)', () => {
    const dir = tempDir();
    const copy = seedFixtureDb(dir, 'copy.db');
    expect(() => assertSqliteDatabaseReady(toFileUrl(copy))).not.toThrow();
  });

  it('refuses a nonexistent database file', () => {
    const dir = tempDir();
    expect(() => assertSqliteDatabaseReady(toFileUrl(path.join(dir, 'nope.db')))).toThrow(
      DatabaseNotReadyError,
    );
  });

  it('refuses an empty database with no Room table — the exact incident this guards against', () => {
    const dir = tempDir();
    const emptyPath = path.join(dir, 'empty.db');
    new DatabaseSync(emptyPath).close(); // a valid but table-less sqlite file
    expect(() => assertSqliteDatabaseReady(toFileUrl(emptyPath))).toThrow(DatabaseNotReadyError);
  });

  it('opens strictly read-only: no write, no journal/wal/shm sidecar files', () => {
    const dir = tempDir();
    const target = seedFixtureDb(dir, 'ro-check.db');
    const before = statSync(target).mtimeMs;

    assertSqliteDatabaseReady(toFileUrl(target));

    expect(statSync(target).mtimeMs).toBe(before);
    expect(readdirSync(path.dirname(target))).toEqual(['ro-check.db']);
  });
});

describe('bootstrapEnv — .env precedence (temp fixture project dirs only)', () => {
  it('.env.development.local outranks .env.development, .env.local, and .env', () => {
    const dir = tempDir();
    const winner = seedFixtureDb(dir, 'winner.db');
    writeFileSync(path.join(dir, '.env'), 'DATABASE_URL="file:./lowest.db"\n');
    writeFileSync(path.join(dir, '.env.local'), 'DATABASE_URL="file:./y.db"\n');
    writeFileSync(path.join(dir, '.env.development'), 'DATABASE_URL="file:./x.db"\n');
    writeFileSync(path.join(dir, '.env.development.local'), 'DATABASE_URL="file:./winner.db"\n');
    setNodeEnv('development');

    const { databaseUrl } = bootstrapEnv(dir);
    expect(databaseUrl).toBe(toFileUrl(winner));
  });

  it('.env.local outranks plain .env when no development-specific file exists', () => {
    const dir = tempDir();
    const local = seedFixtureDb(dir, 'local.db');
    writeFileSync(path.join(dir, '.env'), 'DATABASE_URL="file:./base.db"\n');
    writeFileSync(path.join(dir, '.env.local'), 'DATABASE_URL="file:./local.db"\n');
    setNodeEnv('development');

    const { databaseUrl } = bootstrapEnv(dir);
    expect(databaseUrl).toBe(toFileUrl(local));
  });

  it('falls back to plain .env when nothing more specific exists', () => {
    const dir = tempDir();
    const base = seedFixtureDb(dir, 'base.db');
    writeFileSync(path.join(dir, '.env'), 'DATABASE_URL="file:./base.db"\n');
    setNodeEnv('development');

    const { databaseUrl } = bootstrapEnv(dir);
    expect(databaseUrl).toBe(toFileUrl(base));
  });

  it('a real, deployment-injected environment variable always wins over every .env file', () => {
    // Spawned as a fresh process, not called in-process like the other
    // cases here: @next/env snapshots "the real environment" on its first
    // call in a process and resets to that snapshot on every later call —
    // correct and harmless in the real app (bootstrapEnv only ever runs
    // once per process) but it would make repeated in-process calls in this
    // test suite silently ignore a `process.env.DATABASE_URL` set by a
    // *later* test than whichever ran first. A real process boundary is
    // what actually proves deployment-injected env vars win, matching how
    // this is used for real.
    const dir = tempDir();
    seedFixtureDb(dir, 'from-env-file.db');
    const fromRealEnv = seedFixtureDb(dir, 'from-real-env.db');
    writeFileSync(path.join(dir, '.env'), 'DATABASE_URL="file:./from-env-file.db"\n');

    const fixture = path.join(dir, 'check.ts');
    writeFileSync(
      fixture,
      [
        `import { bootstrapEnv } from '@/server/env-bootstrap';`,
        `const { databaseUrl } = bootstrapEnv(${JSON.stringify(dir)});`,
        `console.log(databaseUrl);`,
      ].join('\n'),
    );

    const projectRoot = path.resolve(__dirname, '..');
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const res = spawnSync(npx, ['tsx', fixture], {
      cwd: projectRoot, // so @/server/env-bootstrap resolves via the real tsconfig paths
      env: { ...process.env, NODE_ENV: 'development', DATABASE_URL: toFileUrl(fromRealEnv) },
      encoding: 'utf-8',
      shell: true,
    });
    if (res.error) throw res.error;
    if (!res.stdout.trim()) throw new Error(`no stdout; stderr was:\n${res.stderr}`);

    const printedUrl = res.stdout.trim().split('\n').pop() ?? '';
    expect(printedUrl).toBe(toFileUrl(fromRealEnv));
  });

  it('production precedence (.env.production(.local)) is honored, independent of dev-mode files', () => {
    const dir = tempDir();
    const prod = seedFixtureDb(dir, 'prod.db');
    writeFileSync(path.join(dir, '.env'), 'DATABASE_URL="file:./base.db"\n');
    writeFileSync(path.join(dir, '.env.development'), 'DATABASE_URL="file:./dev-only.db"\n');
    writeFileSync(path.join(dir, '.env.production'), 'DATABASE_URL="file:./prod.db"\n');
    setNodeEnv('production');

    const { databaseUrl } = bootstrapEnv(dir);
    expect(databaseUrl).toBe(toFileUrl(prod));
  });

  it('throws instead of starting when the resolved database is missing', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, '.env'), 'DATABASE_URL="file:./dev.db"\n'); // no dev.db actually created
    setNodeEnv('development');

    expect(() => bootstrapEnv(dir)).toThrow(DatabaseNotReadyError);
  });

  it('throws instead of starting when DATABASE_URL is not set anywhere', () => {
    const dir = tempDir();
    setNodeEnv('development');

    expect(() => bootstrapEnv(dir)).toThrow(DatabaseNotReadyError);
  });
});

describe('Socket.IO and Next routes resolve the same absolute database', () => {
  it('bootstrapEnv sets process.env.DATABASE_URL once, to the resolved absolute value shared by every later importer', () => {
    // @/server/socket (Socket.IO's registerSocketHandlers) and every Next
    // API route both import the same @/lib/db singleton in the same
    // process. Once bootstrapEnv has run — before either is ever imported,
    // per server.ts's dynamic-import ordering — there is exactly one
    // process.env.DATABASE_URL value left for anything to read; this test
    // pins down that it is the resolved absolute form, not the raw
    // (possibly relative, possibly ambiguous) value from the .env file.
    const dir = tempDir();
    const shared = seedFixtureDb(dir, 'shared.db');
    writeFileSync(path.join(dir, '.env'), 'DATABASE_URL="file:./shared.db"\n');
    setNodeEnv('development');

    bootstrapEnv(dir);

    const resolvedForEveryImporter = process.env.DATABASE_URL!;
    expect(resolvedForEveryImporter).toBe(toFileUrl(shared));
    expect(path.isAbsolute(resolvedForEveryImporter.slice('file:'.length))).toBe(true);
  });
});
