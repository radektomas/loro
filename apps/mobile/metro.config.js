const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

/**
 * Metro config for apps/mobile — the load-bearing file of the whole monorepo
 * wiring.
 *
 * THE SHAPE THIS SOLVES FOR. apps/mobile is deliberately NOT an npm workspace
 * member: the root package.json and root lockfile are what Vercel installs for
 * the production web app, and keeping mobile out of them means no mobile change
 * can ever fail a web deploy. The cost is that @loro/core arrives as a `file:`
 * symlink into a package that lives OUTSIDE this project root, and Metro has to
 * be told about all three consequences of that.
 *
 * Every setting below is here because something concrete breaks without it.
 */

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

/**
 * 1. WATCH THE REPO ROOT.
 *
 * Metro only serves files under projectRoot or a watch folder. @loro/core lives
 * at <repoRoot>/packages/core — outside this project — and core's catalog seam
 * reaches further still: packages/core/src/catalog/staticVideos.ts imports
 * '../../../../data/videos.json', which resolves to <repoRoot>/data/. That
 * specifier is relative to the FILE, so it lands in the same place no matter how
 * deep the consumer is; what it needs is for <repoRoot> to be servable at all.
 *
 * WITHOUT THIS: "Unable to resolve module ../../../../data/videos.json" the
 * moment anything imports @loro/core/storage or @loro/core/catalog. Checkpoint A
 * imports neither, so this line is not yet exercised — checkpoint B is what
 * proves it.
 */
config.watchFolders = [repoRoot];

/**
 * 2. SYMLINKS — nothing to set, and deliberately so.
 *
 * `"@loro/core": "file:../../packages/core"` makes npm write a symlink at
 * node_modules/@loro/core pointing back out of the project, so symlink
 * resolution is the single link this entire app hangs off. It is NOT configured
 * here: Metro has resolved symlinks unconditionally since SDK 52, and setting
 * `resolver.unstable_enableSymlinks` — even to its own default of true — makes
 * `npx expo-doctor` fail with "mismatch. Expected undefined, got: true".
 *
 * A red doctor check on every run is worse than the defensive no-op was good,
 * so the guard is this comment: if `@loro/core/*` ever stops resolving after an
 * SDK bump, symlink handling is the first thing to re-check.
 */

/**
 * 3. PACKAGE EXPORTS.
 *
 * packages/core/package.json declares exactly one entry:
 *
 *   "exports": { "./*": "./src/*.ts" }
 *
 * so `@loro/core/srs` resolves to src/srs.ts and `@loro/core/starter/deck` to
 * src/starter/deck.ts (the `*` pattern matches across `/`). There is no build
 * step and no dist/ — Metro reads core's TypeScript source directly and
 * transforms it with babel-preset-expo, which is why core can stay a plain
 * source package that `node --test` also loads.
 *
 * Default-on since Expo SDK 53, asserted for the same reason as the symlinks:
 * if an SDK bump turns it off, nothing resolves and the error names a file path
 * rather than the missing feature.
 *
 * WITHOUT THIS: "Unable to resolve module @loro/core/srs" — Metro falls back to
 * looking for main/index, which core deliberately does not have.
 */
config.resolver.unstable_enablePackageExports = true;

/**
 * 4. RESOLVE PACKAGES FROM THIS APP'S OWN node_modules FIRST.
 *
 * The repo root has its own node_modules for the web app, pinned to
 * react 19.1.0; this app is on react 19.2.3 (what the SDK 57 template pins).
 * Core's files live under <repoRoot>/packages, so Node's ordinary upward lookup
 * from those files reaches <repoRoot>/node_modules — and a second copy of React
 * inside one bundle is a class of failure that presents as nonsense
 * ("Invalid hook call", duplicate-view registration) rather than as a version
 * error.
 *
 * Pointing nodeModulesPaths at this app's own install makes its copies win.
 *
 * NOTE, deliberately not "fixed" here: hierarchical lookup still lets a file
 * under packages/ reach the root's node_modules. That is currently harmless —
 * checkpoint A's import chain (@loro/core/srs) has zero external dependencies —
 * but it is also how @loro/core would silently resolve @supabase/supabase-js
 * from the WEB's install, which it must not do: packages/core declares no
 * dependencies of its own yet. The correct fix is for core to declare them, at
 * which point npm installs them here through the file: link. Until then this
 * comment is the tripwire.
 */
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

module.exports = config;
