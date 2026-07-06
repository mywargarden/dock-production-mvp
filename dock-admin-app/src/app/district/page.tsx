import Link from 'next/link'

export default function DistrictIndexPage() {
  return (
    <main className="publicShell">
      <section className="card publicHero">
        <div className="heroEyebrow">District Workspaces</div>
        <h1>Open a managed Dock workspace.</h1>
        <p className="muted publicLead">
          District workspace pages show the resources that will appear in Dock after a workspace is published.
        </p>
        <div className="row wrap publicActions">
          <span className="muted">Open a district page directly once a workspace has been published.</span>
          <Link className="buttonLink secondaryLink" href="/admin">Open Admin</Link>
        </div>
      </section>
    </main>
  )
}
