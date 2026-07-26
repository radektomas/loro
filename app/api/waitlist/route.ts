import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * POST /api/waitlist — the /join founding-member list.
 *
 * ANON KEY ONLY. loro_waitlist grants anon exactly one thing (INSERT, see
 * 20260727000000_waitlist.sql), so this is the whole attack surface: a row
 * can be added and nothing can be read back. Deliberately NOT
 * lib/supabaseServer.ts — that client's contract is read-only public data,
 * and this route is a write.
 *
 * Existence never leaks: a duplicate email is a 200 { alreadyJoined: true },
 * the same shape a success takes, and validation failures name only the
 * field, never whether the address is known.
 */

let client: SupabaseClient | null = null;

function getAnonClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  if (!client) {
    client = createClient(url, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

/** Pragmatic shape check — the unique index is the real dedupe authority. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const SOURCES = new Set(['landing', 'landing-hero', 'landing-final']);

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  // Honeypot: humans never see this field. A filled value gets a success
  // response and no insert — bots learn nothing from the status code.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return NextResponse.json({ ok: true });
  }

  if (body.consent !== true) {
    return NextResponse.json(
      { error: 'Please agree to receive launch updates.' },
      { status: 400 }
    );
  }

  const email =
    typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: 'Enter a valid email address.' },
      { status: 400 }
    );
  }

  const source =
    typeof body.source === 'string' && SOURCES.has(body.source)
      ? body.source
      : 'landing';

  const supabase = getAnonClient();
  if (!supabase) {
    console.error('[waitlist] Supabase env vars missing.');
    return NextResponse.json(
      { error: 'Signups are not available right now.' },
      { status: 503 }
    );
  }

  // No .select() — insert goes out as return=minimal, which is what lets the
  // anon role write without any select policy existing.
  const { error } = await supabase
    .from('loro_waitlist')
    .insert({ email, consent: true, source });

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ alreadyJoined: true });
    }
    console.error('[waitlist] insert failed:', error.code, error.message);
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
