import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchCreatorProfile, type ProfileVideo } from '@/lib/creatorProfile';
import { ProfileAction } from '@/components/creator/ProfileAction';
import { Avatar } from '@/components/creator/Avatar';
import { ChevronLeftIcon } from '@/components/icons/Icons';

/**
 * Public creator profile — /creator/[handle].
 *
 * A SERVER component, unlike every other screen in the app: the header, the
 * stats and the grid are public data, and these URLs get sent to creators
 * directly, so the page has to render (and preview) without waiting on
 * client-side auth. The only client island is the follow button.
 *
 * 404 for an unknown handle AND for a pending or rejected application — the
 * page must not let anyone probe which applications exist.
 */

type PageProps = { params: Promise<{ handle: string }> };

/** Two-line bio for link previews — the full bio can run long. */
function previewText(bio: string, nativeLanguage: string): string {
  const trimmed = bio.trim();
  if (!trimmed) return `${nativeLanguage} videos on Loro.`;
  return trimmed.length > 160 ? `${trimmed.slice(0, 157)}…` : trimmed;
}

/** Link-preview image: the creator's avatar, else a poster frame, else none. */
function previewImage(profile: {
  avatarUrl: string | null;
  videos: ProfileVideo[];
}): string | null {
  return (
    profile.avatarUrl ??
    profile.videos.find((v) => v.posterUrl)?.posterUrl ??
    null
  );
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { handle } = await params;
  const profile = await fetchCreatorProfile(handle);
  // Unknown handle: no preview to build, and the page itself 404s.
  if (!profile) return { title: 'Creator not found · Loro' };

  const title = `${profile.displayName} (@${profile.handle}) · Loro`;
  const description = previewText(profile.bio, profile.nativeLanguage);
  const url = `/creator/${profile.handle}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'profile',
      title,
      description,
      url,
      siteName: 'Loro',
      // The avatar is the creator's own chosen picture, so it wins; a poster
      // frame is the fallback (still a real image of their content); with
      // neither, no image tag at all rather than a placeholder.
      images: previewImage(profile) ? [{ url: previewImage(profile)! }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

function initialOf(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

/** One headline number. Mirrors /progress's MetricCard, `hero` and all. */
function Stat({
  value,
  label,
  hero = false,
}: {
  value: number;
  label: string;
  hero?: boolean;
}) {
  return (
    <div
      className={`rounded-3xl px-3 py-5 text-center ${
        hero
          ? 'bg-gradient-to-br from-accent/25 via-accent-soft to-surface ring-1 ring-accent/25'
          : 'bg-surface'
      }`}
    >
      <p className="text-4xl font-bold tabular-nums tracking-tight text-text">
        {value.toLocaleString()}
      </p>
      <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
        {label}
      </p>
    </div>
  );
}

/**
 * A grid tile.
 *
 * The box geometry is fixed and MEDIA-INDEPENDENT: a full-width 9:16 cell
 * with a uniform radius, and the image absolutely positioned inside it. That
 * is the point — a portrait poster, a landscape poster and a missing poster
 * must all occupy an identical box. Letting the <img> participate in layout
 * (h-full/w-full in normal flow) lets its intrinsic size influence the cell
 * through automatic minimum sizing, which is what made tiles differ in width
 * and corner radius. Absolute positioning takes it out of flow entirely, so
 * the cell's size is decided before the image is known, and `min-w-0` stops a
 * wide child from expanding the grid column.
 *
 * When there is no poster the tile is SOLID with the creator's initial —
 * never a <video>. A 3-column grid of video elements would mean N
 * simultaneous media loads on a phone, which is the thing poster frames
 * exist to avoid.
 */
function VideoTile({
  video,
  handle,
  initial,
}: {
  video: ProfileVideo;
  handle: string;
  initial: string;
}) {
  return (
    <Link
      href={`/?creator=${encodeURIComponent(handle)}&v=${encodeURIComponent(video.id)}`}
      className="relative block aspect-[9/16] w-full min-w-0 overflow-hidden rounded-xl bg-surface-raised"
    >
      {video.posterUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={video.posterUrl}
          alt={video.title ?? ''}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-3xl font-bold text-muted/40">
          {initial}
        </span>
      )}
      {/* Same corner, same offsets, on every tile — including the fallback. */}
      <span className="absolute bottom-1.5 left-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-text backdrop-blur-sm">
        {video.level}
      </span>
    </Link>
  );
}

export default async function CreatorProfilePage({ params }: PageProps) {
  const { handle } = await params;
  const profile = await fetchCreatorProfile(handle);
  if (!profile) notFound();

  const initial = initialOf(profile.displayName);

  return (
    <main className="min-h-[100dvh] bg-background pb-safe">
      <header className="sticky top-0 z-10 bg-background/85 pt-safe backdrop-blur-md">
        <div className="flex items-center gap-2 px-4 py-4">
          <Link
            href="/"
            aria-label="Back to feed"
            className="rounded-full bg-surface p-2 text-muted transition-colors hover:text-text"
          >
            <ChevronLeftIcon width={20} height={20} />
          </Link>
          <h1 className="truncate text-xl font-bold tracking-tight text-text">
            {profile.displayName}
          </h1>
        </div>
      </header>

      <div className="mx-auto max-w-md space-y-8 px-4 pb-10">
        <section>
          <div className="flex items-start gap-4">
            <Avatar
              url={profile.avatarUrl}
              name={profile.displayName}
              size={80}
            />
            <div className="min-w-0 flex-1 pt-1">
              <p className="truncate text-lg font-bold tracking-tight text-text">
                {profile.displayName}
              </p>
              <p className="truncate text-sm text-muted">@{profile.handle}</p>
              <p className="mt-1 text-xs font-semibold text-accent">
                {profile.nativeLanguage}
              </p>
            </div>
            <ProfileAction
              creator={{
                userId: profile.userId,
                displayName: profile.displayName,
                handle: profile.handle,
                bio: profile.bio,
                avatarUrl: profile.avatarUrl,
              }}
            />
          </div>
          {profile.bio && (
            <p className="mt-4 text-sm leading-relaxed text-muted">
              {profile.bio}
            </p>
          )}
        </section>

        {/* Videos, followers, and — once it means something — the number that
            is the whole point of this page: what people have actually learned
            here. It gets the same weight as followers, not a footnote. */}
        <section
          className={`grid gap-2 ${
            profile.wordsLearned === null ? 'grid-cols-2' : 'grid-cols-3'
          }`}
        >
          <Stat value={profile.videos.length} label="Videos" />
          <Stat value={profile.followerCount} label="Followers" />
          {profile.wordsLearned !== null && (
            <Stat value={profile.wordsLearned} label="Words learned" hero />
          )}
        </section>

        <section>
          {profile.videos.length > 0 ? (
            <div className="grid grid-cols-3 gap-1.5">
              {profile.videos.map((video) => (
                <VideoTile
                  key={video.id}
                  video={video}
                  handle={profile.handle}
                  initial={initial}
                />
              ))}
            </div>
          ) : (
            <p className="rounded-3xl bg-surface px-5 py-8 text-center text-sm leading-relaxed text-muted">
              No videos yet. {profile.displayName.split(' ')[0]} is just getting
              started.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
