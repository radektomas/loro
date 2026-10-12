#!/usr/bin/env node
/**
 * Loro — upload the paywall demo clip the app plays in front of the launch wall
 * (apps/mobile/src/paywall/DemoIntro.tsx).
 *
 *   node scripts/upload-demo.mts                       # uploads branding/demo/loro-demo-v1.mp4
 *   node scripts/upload-demo.mts branding/demo/loro-demo-v2.mp4
 *
 * Goes to config/demo/<file name> in the public loro-catalog bucket. The
 * name is the version: to swap the clip, upload a NEW name and bump DEMO_FILE
 * in DemoIntro.tsx, so no device keeps a cached old clip under the same URL.
 *
 * Make the file from a screen recording with:
 *   ffmpeg -i rec.mov -an -vf "drawbox=x=0:y=0:w=iw:h=150:color=0x0A0D0B:t=fill,setpts=PTS/1.25,fps=30,scale=590:-2" \
 *     -c:v libx264 -profile:v main -pix_fmt yuv420p -crf 26 -movflags +faststart out.mp4
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL in .env.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getAdminClient } from './lib/supabaseAdmin.mts';
import { SNAPSHOT_BUCKET } from './lib/catalog.mts';
import { REPO_ROOT } from './lib/env.mts';

const file = process.argv[2] ?? 'branding/demo/loro-demo-v1.mp4';
const dest = `config/demo/${path.basename(file)}`;
const body = readFileSync(path.resolve(REPO_ROOT, file));
const { error } = await getAdminClient()
  .storage.from(SNAPSHOT_BUCKET)
  .upload(dest, body, { contentType: 'video/mp4', cacheControl: '31536000', upsert: true });
if (error) {
  console.error(`✗ upload failed: ${error.message}`);
  process.exit(1);
}
console.log(`✓ ${dest} (${(body.length / 1e6).toFixed(2)} MB)`);
console.log(`  https://iqfsnkmtpffrepcedwih.supabase.co/storage/v1/object/public/${SNAPSHOT_BUCKET}/${dest}`);
