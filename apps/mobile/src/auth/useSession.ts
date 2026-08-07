import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSession, onAuthChange } from '@loro/core/auth';
import { authEnabled } from '../platform/supabaseInit';

/**
 * The current Supabase session, live.
 *
 * `ready` distinguishes "we have not looked yet" from "looked, nobody is
 * signed in" — the two are identical in `session` and must not be, because
 * rendering a sign-in invitation during the first async read makes it flash on
 * screen for a signed-in user on every launch. The web's SignInCard holds the
 * same flag for the same reason.
 *
 * SUBSCRIBING HERE IS NOT WHAT DRIVES SYNC. storage.initSync() attached its own
 * listener at boot, long before this hook mounts, and that one runs the merge.
 * This is purely for rendering, so a screen mounting or unmounting can never
 * affect whether the user's data syncs.
 */
export function useSession(): { session: Session | null; ready: boolean } {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!authEnabled) {
      setReady(true);
      return;
    }
    let live = true;
    void getSession().then((s) => {
      if (!live) return;
      setSession(s);
      setReady(true);
    });
    const unsub = onAuthChange((s) => {
      if (live) setSession(s);
    });
    return () => {
      live = false;
      unsub();
    };
  }, []);

  return { session, ready };
}
