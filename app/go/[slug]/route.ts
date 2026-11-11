import { NextResponse } from 'next/server';
import { getServiceRole } from '../../api/_lib/serviceRole';
import { GO_SLUGS, appStoreUrl, isGoSlug, uaKind } from '@/lib/goLinks';

export const dynamic = 'force-dynamic';

/**
 * GET /go/<slug> — a bio link. Counts the tap (channel, time, human or bot;
 * nothing about the person) and forwards to the App Store with the channel's
 * campaign tag. A failed count never blocks the redirect.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const target = appStoreUrl(slug);
  if (!target || !isGoSlug(slug)) return NextResponse.redirect('https://getloro.app', 302);

  try {
    const { error } = await getServiceRole()
      .from('loro_marketing_link_taps')
      .insert({ channel: GO_SLUGS[slug], ua_kind: uaKind(req.headers.get('user-agent')) });
    if (error) console.error('go: tap not counted:', error.message);
  } catch (e) {
    console.error('go: tap not counted:', (e as Error).message);
  }

  const res = NextResponse.redirect(target, 302);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
