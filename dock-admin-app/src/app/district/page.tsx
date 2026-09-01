import Link from 'next/link'

export default function DistrictIndexPage() {
  return (
    <main className="publicShell">
      <section className="card publicHero">
        <div className="heroEyebrow">District Workspaces</div>
        <h1>Managed Dock workspaces are protected.</h1>
        <p className="muted publicLead">
          Published district resources are delivered inside Dock only after the signed-in user and current district access are verified.
        </p>
        <div className="row wrap publicActions">
          <Link className="buttonLink" href="/admin">Open District Admin</Link>
          <Link className="buttonLink secondaryLink" href="/">Dock Home</Link>
        </div>
      </section>
    </main>
  )
}
