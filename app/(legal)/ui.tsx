/**
 * Tiny typographic kit for the legal pages. Server components only — these
 * pages ship zero client JS. Body copy is deliberately text-sm text-muted
 * with relaxed leading: readable, quiet, and clearly secondary to the app.
 */

export function PageTitle({
  title,
  updated,
}: {
  title: string;
  updated?: string;
}) {
  return (
    <header>
      <h1 className="text-3xl font-bold tracking-[-0.02em] text-text">
        {title}
      </h1>
      {updated && (
        <p className="mt-2 text-xs text-muted">Last updated: {updated}</p>
      )}
    </header>
  );
}

export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-bold tracking-tight text-text">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted">
        {children}
      </div>
    </section>
  );
}

export function UL({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-1.5 pl-5">{children}</ul>;
}

/** Definition-style rows for processor / storage-key inventories. */
export function Rows({
  rows,
}: {
  rows: ReadonlyArray<{ term: string; def: React.ReactNode }>;
}) {
  return (
    <dl className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.term} className="rounded-2xl bg-surface p-3.5">
          <dt className="text-[13px] font-semibold text-text">{r.term}</dt>
          <dd className="mt-0.5 text-[13px] leading-relaxed text-muted">
            {r.def}
          </dd>
        </div>
      ))}
    </dl>
  );
}
