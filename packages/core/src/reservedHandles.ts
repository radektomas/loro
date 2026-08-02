/**
 * Handles nobody may claim.
 *
 * Two reasons, and the first is the load-bearing one: /creator/apply and
 * /creator/upload are real static routes, and Next resolves a static segment
 * before the dynamic [handle] one. A creator holding the handle "apply" would
 * get a profile page that is permanently unreachable — the apply form renders
 * instead. The rest are reserved for routes that plausibly land under
 * /creator/* later, and for words that would read as official Loro pages.
 *
 * Enforced at APPLICATION time (lib/creators.ts + the apply form), not in the
 * database: it is product policy, and the list will grow as routes are added.
 * Existing rows are never rewritten by this — the poster backfill script
 * reports collisions instead (a rename would break every link to that
 * profile, so it is a human decision).
 */

export const RESERVED_HANDLES: readonly string[] = [
  'apply',
  'upload',
  'admin',
  'api',
  'feed',
  'progress',
  'settings',
  'new',
  'edit',
];

/**
 * Case-insensitive, matching the database's own uniqueness rule
 * (loro_creators_handle_key is unique on lower(handle)) — otherwise "Apply"
 * would pass this check and still collide with the reserved "apply".
 */
export function isReservedHandle(handle: string): boolean {
  return RESERVED_HANDLES.includes(handle.trim().toLowerCase());
}
