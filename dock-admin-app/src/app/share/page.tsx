export default function DockSharePage() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#fbf7f2', color: '#1c2a3a' }}>
      <section style={{ width: 'min(560px, 100%)', padding: 28, borderRadius: 24, background: 'rgba(255,255,255,.92)', boxShadow: '0 18px 48px rgba(28,42,58,.10)', textAlign: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: '#2b8c8f' }}>Dock Share</div>
        <h1 style={{ margin: '12px 0 8px', fontSize: 32 }}>Opening this Dock…</h1>
        <p style={{ margin: 0, lineHeight: 1.55, color: '#5a6775' }}>
          If Dock is installed, the shared Dock will open in Safe Harbor automatically.
        </p>
      </section>
    </main>
  )
}
