export default function HomePage() {
  return (
    <main className="shell">
      <section className="topbar">
        <div className="brand">
          <small>Dock</small>
          <h1>District License Admin</h1>
          <p className="muted">Manage districts, domains, users, seats, and license states.</p>
        </div>
        <a href="/admin"><button>Open Admin</button></a>
      </section>
      <section className="card">
        <h2>Production controls</h2>
        <p>This backend powers the paid district license system for Dock. Keep admin tokens and Supabase/Stripe secret keys server-side only.</p>
      </section>
    </main>
  );
}
