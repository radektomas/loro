import { initCatalog } from '@loro/core/catalog';
import { localVideos } from '@loro/core/catalog/localVideos';

/**
 * Web bootstrap for @loro/core's catalog seam. Sibling of lib/platformInit.ts
 * and lib/supabaseInit.ts, same contract — this runs as an IMPORT SIDE EFFECT
 * from the top of components/SyncInit.tsx (mounted by the root layout on every
 * route), so the catalog is installed during module evaluation, before
 * anything renders and reads it synchronously.
 *
 * MODULE SCOPE, NOT AN EFFECT. If this ran in a useEffect the first render —
 * server AND client — would read the resting seed instead of the full
 * catalog: an 8-video feed that pops to 216 after hydration, an empty video
 * filter on /vocab, a language picker with almost nothing in it, and a server
 * render that disagrees with the client. The whole point of the seam is that
 * it is filled before the first read, exactly like the storage driver.
 *
 * NO `typeof window` GUARD, deliberately — and this is where it differs from
 * platformInit. That guard exists there because localStorage does not exist on
 * the server; the catalog is plain bundled data with no browser dependency,
 * and the server render needs the SAME list the client will hydrate with. A
 * guard here would reintroduce precisely the mismatch described above.
 *
 * This IS today's behaviour, relocated: the identical localVideos array that
 * every screen used to import directly, installed in one place instead of six.
 */

initCatalog(localVideos);
