import Image from 'next/image';
import Link from 'next/link';

/**
 * Shared chrome for the legal pages (/privacy, /terms) — route group only,
 * does not affect URLs. Server-rendered, zero client JS, same design
 * language as the landing: dark base, generous air, muted body type.
 */
export default function LegalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="min-h-[100dvh] bg-background text-text">
      <div className="mx-auto max-w-2xl px-6 pb-24 pt-12">
        <Link href="/" aria-label="Loro home" className="inline-block">
          <Image
            src="/brand/loro-logo.png"
            alt="Loro"
            width={880}
            height={436}
            className="h-auto w-28"
          />
        </Link>
        <div className="mt-12">{children}</div>
        <footer className="mt-20 flex items-center gap-6 border-t border-white/5 pt-8 text-xs text-muted">
          <Link href="/" className="transition-colors hover:text-text">
            Home
          </Link>
          <Link href="/privacy" className="transition-colors hover:text-text">
            Privacy
          </Link>
          <Link href="/terms" className="transition-colors hover:text-text">
            Terms
          </Link>
          <span className="ml-auto">© 2026 Loro</span>
        </footer>
      </div>
    </main>
  );
}
