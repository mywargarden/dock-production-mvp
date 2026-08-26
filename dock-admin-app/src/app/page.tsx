import Link from 'next/link'

export default function Home() {
  return (
    <main className="publicShell">
      <section className="card publicHero">
        <div className="heroEyebrow">Dock for Schools</div>
        <h1>One calmer workspace. Clear roles.</h1>
        <p className="muted publicLead">
          Dock keeps district resources organized and recoverable while separating owner operations from school administration.
        </p>
        <div className="row wrap publicActions">
          <Link className="buttonLink" href="/owner">Open Dock HQ</Link>
          <Link className="buttonLink secondaryLink" href="/admin">Open District Admin</Link>
        </div>
      </section>

      <section className="publicGrid">
        <div className="card">
          <h2>Dock HQ</h2>
          <p className="muted">Owner-only control for customers, licenses, seats, themes, billing, releases, and system health.</p>
        </div>
        <div className="card">
          <h2>District Admin</h2>
          <p className="muted">District staff manage their own published links and workspace content without touching owner controls.</p>
        </div>
        <div className="card">
          <h2>Managed Dock</h2>
          <p className="muted">Verified users receive the correct district workspace through the extension automatically.</p>
        </div>
      </section>
    </main>
  )
}
