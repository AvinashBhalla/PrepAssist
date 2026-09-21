const foundationItems = [
  "Research pipeline",
  "Role requirements",
  "Question coverage",
  "Study schedule",
];

export default function HomePage() {
  return (
    <main className="min-h-screen px-6 py-8 sm:px-10 lg:px-16">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl flex-col">
        <header className="flex items-center justify-between border-b border-[var(--line)] pb-5">
          <span className="text-lg font-semibold tracking-tight">PrepAssist</span>
          <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">
            Foundation
          </span>
        </header>

        <section className="grid flex-1 items-center gap-12 py-16 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <p className="mb-5 text-sm font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">
              Interview preparation, organized
            </p>
            <h1 className="max-w-3xl text-5xl leading-[0.98] tracking-[-0.04em] sm:text-7xl">
              Turn a job description into a plan you can trust.
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-[var(--muted)]">
              PrepAssist will bring company research, role requirements, practice questions, and a focused study schedule into one editable workspace.
            </p>
            <button className="mt-9 rounded-md bg-[var(--ink)] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent)]">
              Create a preparation kit
            </button>
          </div>

          <aside className="border-l-4 border-[var(--accent)] bg-[var(--surface)] p-7 shadow-[0_20px_45px_rgba(23,33,43,0.08)]">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
              Workspace foundation
            </p>
            <ul className="mt-6 space-y-4">
              {foundationItems.map((item, index) => (
                <li key={item} className="flex items-center gap-3 border-b border-[var(--line)] pb-4 text-lg">
                  <span className="font-mono text-sm text-[var(--accent)]">0{index + 1}</span>
                  {item}
                </li>
              ))}
            </ul>
          </aside>
        </section>

        <footer className="border-t border-[var(--line)] pt-5 text-sm text-[var(--muted)]">
          A clear starting point for deliberate preparation.
        </footer>
      </div>
    </main>
  );
}