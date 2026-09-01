import Link from 'next/link'

type DistrictPageProps = {
  params: { orgCode: string }
}

export default async function DistrictWorkspacePage({ params }: DistrictPageProps) {
  const orgCode = String(params.orgCode || '').trim()

  return (
    <main className="publicShell">
      <section className="card publicHero">
        <div className="heroEyebrow">District Workspace</div>
        <h1>{orgCode || 'Dock District'}</h1>
        <p className="muted publicLead">
          Managed workspace contents are protected and are delivered only after Dock verifies the signed-in user, current district membership, account status, license, and tenant boundary.
        </p>
        <div className="row wrap publicActions">
          <Link className="buttonLink" href="/admin">Open District Admin</Link>
          <Link className="buttonLink secondaryLink" href="/">Dock Home</Link>
        </div>
      </section>
    </main>
  )
}
