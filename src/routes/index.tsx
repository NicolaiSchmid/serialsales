import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  return (
    <main className="app-shell">
      <section className="masthead">
        <p className="eyebrow">Serial Sales</p>
        <h1>Transcript Archive</h1>
        <form className="search-bar" role="search">
          <input
            aria-label="Search transcripts"
            name="q"
            placeholder="Search transcripts"
            type="search"
          />
          <button type="submit">Search</button>
        </form>
      </section>

      <section className="status-grid" aria-label="Archive status">
        <article>
          <span>Source</span>
          <strong>YouTube captions</strong>
        </article>
        <article>
          <span>Storage</span>
          <strong>R2 + D1</strong>
        </article>
        <article>
          <span>Updater</span>
          <strong>Cloudflare Cron</strong>
        </article>
      </section>
    </main>
  )
}
