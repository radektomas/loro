import { NextResponse } from 'next/server';

/**
 * Hands a freshly-uploaded creator video to the n8n import workflow
 * (upload -> whisper -> gloss -> publish). The webhook URL lives server-side
 * in N8N_IMPORT_WEBHOOK_URL so it never ships to the browser.
 *
 * The caller must present their Supabase access token; creator_id is taken
 * from the VERIFIED token, never from the request body, and the storage path
 * must live under the caller's own folder — so nobody can trigger imports for
 * other people's files.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const webhook = process.env.N8N_IMPORT_WEBHOOK_URL;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!webhook || !supabaseUrl || !anonKey) {
    return NextResponse.json(
      { error: 'Import pipeline is not configured.' },
      { status: 503 }
    );
  }

  const token = (req.headers.get('authorization') ?? '').replace(
    /^Bearer\s+/i,
    ''
  );
  if (!token) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  // Verify the JWT against Supabase Auth and resolve the real user id.
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!userRes.ok) {
    return NextResponse.json({ error: 'Invalid session.' }, { status: 401 });
  }
  const user = (await userRes.json()) as { id?: string };
  if (!user.id) {
    return NextResponse.json({ error: 'Invalid session.' }, { status: 401 });
  }

  let body: {
    video_id?: string;
    storage_path?: string;
    audio_path?: string;
    duration?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request body.' }, { status: 400 });
  }

  const { video_id, storage_path, audio_path, duration } = body;
  if (
    typeof video_id !== 'string' ||
    !UUID_RE.test(video_id) ||
    typeof storage_path !== 'string' ||
    !storage_path.startsWith(`${user.id}/`) ||
    // The transcription input must also live in the caller's own folder.
    typeof audio_path !== 'string' ||
    !audio_path.startsWith(`${user.id}/`) ||
    typeof duration !== 'number' ||
    !Number.isFinite(duration)
  ) {
    return NextResponse.json({ error: 'Bad request body.' }, { status: 400 });
  }

  const n8nRes = await fetch(webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      video_id,
      creator_id: user.id,
      storage_path,
      audio_path,
      duration,
    }),
  });

  if (!n8nRes.ok) {
    return NextResponse.json(
      { error: `Import webhook responded ${n8nRes.status}.` },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true });
}
