import { redirect } from 'next/navigation';

/**
 * /admin has no content of its own — the dashboard lives at /admin/analytics
 * and the review queue at /admin/creators. Before this file existed the bare
 * path 404'd, which reads as "the dashboard is gone" to anyone arriving from
 * a bookmark or muscle memory. A redirect, not a menu: two destinations do
 * not need a landing page, and analytics is the one an admin opens daily.
 */
export default function AdminIndex(): never {
  redirect('/admin/analytics');
}
