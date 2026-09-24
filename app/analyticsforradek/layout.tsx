import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/** A private page: kept out of search results and link previews. */
export const metadata: Metadata = {
  title: 'Loro numbers',
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
