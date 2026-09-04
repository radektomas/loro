import { redirect } from 'next/navigation';

/**
 * /admin has no content of its own — the numbers live at /admin/analytics, the
 * UGC review queue at /admin/creators, and the published video catalog at
 * /admin/catalog. Before this file existed the bare path 404'd, which reads as
 * "the dashboard is gone" to anyone arriving from a bookmark or muscle memory.
 *
 * Still a redirect rather than a menu, and deliberately still to analytics:
 * that is the one an admin opens daily, and changing the destination would
 * break the muscle memory this file was added to serve. The other two are
 * reachable from its header.
 */
export default function AdminIndex(): never {
  redirect('/admin/analytics');
}
