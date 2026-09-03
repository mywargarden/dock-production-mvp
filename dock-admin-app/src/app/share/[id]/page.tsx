import { getShareAdminClient, sanitizeShareId } from '@/lib/shareServer'

type SharePageProps = {
  params: Promise<{ id: string }>
}

export const dynamic = 'force-dynamic'

export default async function DockSharePage({ params }: SharePageProps) {
  const { id: rawId } = await params
  const id = sanitizeShareId(rawId)

  let extensionId = ''
  let available = false

  if (id) {
    const service = getShareAdminClient()
    const { data } = await service
      .from('dock_shares')
      .select('extension_id,expires_at')
      .eq('id', id)
      .maybeSingle()

    const notExpired = !data?.expires_at || Date.parse(data.expires_at) > Date.now()
    const candidateExtensionId = String(data?.extension_id || '').trim().toLowerCase()
    if (data && notExpired && /^[a-p]{32}$/.test(candidateExtensionId)) {
      extensionId = candidateExtensionId
      available = true
    }
  }

  const openUrl = available
    ? `chrome-extension://${extensionId}/import.html#share=${encodeURIComponent(id)}`
    : ''

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#fbf7f2', color: '#1c2a3a' }}>
      <section style={{ width: 'min(560px, 100%)', padding: 28, borderRadius: 24, background: 'rgba(255,255,255,.92)', boxShadow: '0 18px 48px rgba(28,42,58,.10)', textAlign: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: '#2b8c8f' }}>Dock Share</div>
        <h1 style={{ margin: '12px 0 8px', fontSize: 32 }}>{available ? 'A Dock was shared with you' : 'This Dock share is unavailable'}</h1>
        <p style={{ margin: '0 0 20px', lineHeight: 1.55, color: '#5a6775' }}>
          {available
            ? 'Add a copy to your Dock library. Shared websites will not open automatically.'
            : 'The link may be invalid, expired, or from an older unsupported share.'}
        </p>
        {available ? (
          <a
            href={openUrl}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 46, padding: '0 20px', borderRadius: 999, background: '#2b8c8f', color: '#fff', fontWeight: 800, textDecoration: 'none' }}
          >
            Add to Dock
          </a>
        ) : null}
        <p style={{ margin: '18px 0 0', fontSize: 13, lineHeight: 1.5, color: '#7b8793' }}>
          Dock verifies the signed-in recipient before retrieving the shared workspace. Personal Notes and screenshots are not included.
        </p>
      </section>
    </main>
  )
}
