import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { getAdminClient } from './lib/supabaseAdmin.mts';
import { RESERVED_HANDLES } from '../lib/reservedHandles.ts';

/**
 * Backfill poster frames for published videos uploaded before the browser
 * extracted them (lib/prepareClip.ts does it at upload time now).
 *
 *   npm run backfill-posters              # all published rows with no poster
 *   npm run backfill-posters -- --dry-run # report only, write nothing
 *   npm run backfill-posters -- --limit 5
 *
 * Server-side ffmpeg, same frame as the browser path (~1s in, long edge 480,
 * JPEG) so backfilled tiles are indistinguishable from new ones. Requires
 * ffmpeg on PATH.
 *
 * Also reports (never fixes) creators holding a RESERVED handle: those
 * profiles are shadowed by a static route and are unreachable, but renaming
 * one breaks every existing link to it, so it is a human decision.
 */

const execFileAsync = promisify(execFile);

const POSTER_SECONDS = 1;
const POSTER_MAX_WIDTH = 480;
const BUCKET = process.env.NEXT_PUBLIC_LORO_VIDEOS_BUCKET ?? 'loro-videos';

type Row = {
  id: string;
  creator_id: string;
  storage_path: string;
  title: string | null;
};

function parseArgs(): { dryRun: boolean; limit: number | null } {
  const argv = process.argv.slice(2);
  const limitAt = argv.indexOf('--limit');
  const limit = limitAt >= 0 ? Number(argv[limitAt + 1]) : NaN;
  return {
    dryRun: argv.includes('--dry-run'),
    limit: Number.isFinite(limit) && limit > 0 ? limit : null,
  };
}

/** Extract one frame, retrying at 0 for clips shorter than the seek point. */
async function extractPoster(
  videoPath: string,
  outPath: string
): Promise<boolean> {
  for (const seek of [POSTER_SECONDS, 0]) {
    try {
      await execFileAsync('ffmpeg', [
        '-y',
        '-ss', String(seek),
        '-i', videoPath,
        '-frames:v', '1',
        '-vf', `scale='min(iw,${POSTER_MAX_WIDTH})':-2`,
        '-q:v', '4',
        outPath,
      ]);
      const stat = await readFile(outPath);
      if (stat.byteLength > 0) return true;
    } catch {
      // try the next seek point
    }
  }
  return false;
}

async function reportReservedHandles(): Promise<void> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from('loro_creators')
    .select('user_id, handle, status');
  if (error) {
    console.error(`  could not check handles: ${error.message}`);
    return;
  }
  const reserved = new Set(RESERVED_HANDLES);
  const clashes = (data as { user_id: string; handle: string; status: string }[])
    .filter((c) => reserved.has(c.handle.trim().toLowerCase()));
  if (clashes.length === 0) {
    console.log('  none — no creator holds a reserved handle.');
    return;
  }
  console.log(
    `  ${clashes.length} creator(s) hold a reserved handle. Their profile\n` +
      '  page is shadowed by a static route and cannot load. Renaming breaks\n' +
      '  existing links, so this is left to you:'
  );
  for (const c of clashes) {
    console.log(`    @${c.handle}  (${c.status})  user_id=${c.user_id}`);
  }
}

async function main(): Promise<void> {
  const { dryRun, limit } = parseArgs();
  const supabase = getAdminClient();

  // Fail early and loudly if ffmpeg isn't there — better than N identical
  // per-row failures.
  try {
    await execFileAsync('ffmpeg', ['-version']);
  } catch {
    console.error('\nffmpeg not found on PATH. Install it and re-run.\n');
    process.exit(1);
  }

  let query = supabase
    .from('loro_videos')
    .select('id, creator_id, storage_path, title')
    .eq('status', 'published')
    .is('poster_path', null)
    .order('published_at', { ascending: true });
  if (limit) query = query.limit(limit);

  const { data, error } = await query;
  if (error) {
    console.error(`\nCould not list videos: ${error.message}\n`);
    process.exit(1);
  }
  const rows = (data ?? []) as Row[];

  console.log(
    `\n${rows.length} published video(s) without a poster${dryRun ? ' (dry run)' : ''}.\n`
  );

  const workDir = await mkdtemp(path.join(tmpdir(), 'loro-posters-'));
  let done = 0;
  let failed = 0;

  try {
    for (const row of rows) {
      const label = row.title ?? row.id;
      if (dryRun) {
        console.log(`  would backfill ${label}`);
        continue;
      }

      const videoPath = path.join(workDir, `${row.id}.mp4`);
      const posterPath = path.join(workDir, `${row.id}.jpg`);
      try {
        const { data: blob, error: dlError } = await supabase.storage
          .from(BUCKET)
          .download(row.storage_path);
        if (dlError || !blob) {
          throw new Error(dlError?.message ?? 'download returned no data');
        }
        await writeFile(videoPath, Buffer.from(await blob.arrayBuffer()));

        if (!(await extractPoster(videoPath, posterPath))) {
          throw new Error('ffmpeg produced no frame');
        }

        // <user_id>/<video_id>.poster.jpg — same layout as the upload path,
        // which the storage policies are written against.
        const storageKey = `${row.creator_id}/${row.id}.poster.jpg`;
        const { error: upError } = await supabase.storage
          .from(BUCKET)
          .upload(storageKey, await readFile(posterPath), {
            contentType: 'image/jpeg',
            upsert: true,
          });
        if (upError) throw new Error(upError.message);

        // Written LAST: a row pointing at a missing object would render a
        // broken tile, while an orphaned object just costs pennies.
        const { error: rowError } = await supabase
          .from('loro_videos')
          .update({ poster_path: storageKey })
          .eq('id', row.id);
        if (rowError) throw new Error(rowError.message);

        done++;
        console.log(`  ✓ ${label}`);
      } catch (err) {
        failed++;
        console.error(
          `  ✗ ${label}: ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        await rm(videoPath, { force: true });
        await rm(posterPath, { force: true });
      }
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }

  if (!dryRun) {
    console.log(`\n${done} backfilled, ${failed} failed.`);
  }

  console.log('\nReserved-handle check:');
  await reportReservedHandles();
  console.log('');
}

await main();
