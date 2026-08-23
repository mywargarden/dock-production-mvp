import Link from 'next/link'

export default function Home() {
  return (
    <main className="publicShell">
      <section className="card publicHero">
        <div className="heroEyebrow">Dock for Schools</div>
        <h1>A calmer browser workspace for districts.</h1>
        <p className="muted publicLead">
          Dock gives schools a managed Safe Harbor where important resources stay organized,
          recoverable, and easy to reopen without overwhelming teachers or students.
        </p>
        <div className="row wrap publicActions">
          <Link className="buttonLink" href="/admin">Open District Admin</Link>
          <Link className="buttonLink secondaryLink" href="/district">View Workspace Pages</Link>
          <Link className="buttonLink secondaryLink" href="/owner">Open Dock HQ</Link>
        </div>
      </section>

      <section className="publicGrid">
        <div className="card">
          <h2>Safe Harbor</h2>
          <p className="muted">
            A persistent workspace where district resources and personal memories can be recovered
            without losing browser context.
          </p>
        </div>
        <div className="card">
          <h2>District managed</h2>
          <p className="muted">
            Published workspaces can be attached to verified school email domains and pushed through
            managed extension deployment.
          </p>
        </div>
        <div className="card">
          <h2>Owner controlled</h2>
          <p className="muted">
            Dock HQ keeps customer accounts, licensing, branding, access, releases, and operations
            together in one owner-only control plane.
          </p>
        </div>
      </section>
    </main>
  )
}
