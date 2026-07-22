/**
 * A creator's avatar: their uploaded image when there is one, the initial
 * circle when there isn't.
 *
 * ONE implementation, used by the profile header, the feed's author line and
 * the edit sheet's preview. Two of anything here would drift — the fallback
 * is the case that renders for most creators, and it has to look identical
 * everywhere it appears.
 *
 * Not a client component: it renders the same for every viewer, so it stays
 * server-renderable and works inside the profile page without pulling it into
 * the client bundle.
 */
export function Avatar({
  url,
  name,
  size,
  className = '',
}: {
  url: string | null;
  /** Display name — only the first character is used, for the fallback. */
  name: string;
  /** Rendered box in px. Square; the image is center-cropped into it. */
  size: number;
  className?: string;
}) {
  const box = { width: size, height: size };

  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        style={box}
        className={`shrink-0 rounded-full bg-surface-raised object-cover ${className}`}
      />
    );
  }

  return (
    <span
      style={{ ...box, fontSize: Math.round(size * 0.4) }}
      className={`flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-bold text-accent ${className}`}
      aria-hidden
    >
      {(name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}
