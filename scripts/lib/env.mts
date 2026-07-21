import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Env loading for the CLI scripts.
 *
 * Next.js loads .env itself, but a bare `node scripts/*.ts` process gets
 * nothing — so we replicate Next's precedence here with Node's built-in
 * loader (no dotenv dependency):
 *
 *   shell-exported vars  >  .env.local  >  .env
 *
 * process.loadEnvFile never overwrites a variable that is already set, so
 * loading .env.local first makes it win over .env, and anything exported in
 * the shell wins over both. That is the same order Next uses, and it is why
 * .env.local in this repo carries a warning about empty assignments.
 */

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  for (const file of ['.env.local', '.env']) {
    const full = path.join(REPO_ROOT, file);
    if (existsSync(full)) process.loadEnvFile(full);
  }
}

/**
 * Read a required variable, or exit with an actionable message. Scripts are
 * run by a human at a terminal — a stack trace about `undefined` is a worse
 * answer than naming the variable and the file it belongs in.
 */
export function requireEnv(name: string): string {
  loadEnv();
  const value = process.env[name];
  if (!value) {
    console.error(
      `\nMissing ${name}.\n\n` +
        `Add it to .env (see .env.example for what each variable is for), ` +
        `or export it in your shell.\n`
    );
    process.exit(1);
  }
  return value;
}
