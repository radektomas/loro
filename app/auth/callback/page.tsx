'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { LoroMascot } from '@/components/LoroMascot';

/**
 * Auth redirect target for magic-link and Google OAuth. We handle the exchange
 * here (detectSessionInUrl is off in the client) so both flows take one path:
 *   - PKCE / OAuth / magic-link -> ?code=...  -> exchangeCodeForSession
 *   - email OTP link            -> ?token_hash=&type=... -> verifyOtp
 * On success the storage sync engine picks up the new session via its auth
 * listener and merges/hydrates in the background. Then we drop the user back
 * into the app.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      router.replace('/');
      return;
    }

    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const tokenHash = params.get('token_hash');
      const type = params.get('type');

      try {
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (tokenHash && type) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: type as 'magiclink' | 'email' | 'signup' | 'recovery',
          });
          if (error) throw error;
        }
        router.replace('/progress');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Sign-in failed.');
      }
    };

    void run();
  }, [router]);

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-5 bg-background px-8 text-center">
      <LoroMascot state={error ? 'idle' : 'happy'} size={96} />
      {error ? (
        <>
          <p className="text-sm text-muted">{error}</p>
          <button
            type="button"
            onClick={() => router.replace('/progress')}
            className="rounded-2xl bg-accent px-6 py-3 text-sm font-semibold text-background transition-transform active:scale-95"
          >
            Back to Loro
          </button>
        </>
      ) : (
        <p className="text-sm text-muted">Signing you in…</p>
      )}
    </main>
  );
}
