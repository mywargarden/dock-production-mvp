import Link from 'next/link'
import AdminPage from './page_admin_surgical_fix'

export default function DistrictAdminRoute() {
  return (
    <>
      <div className="roleNav">
        <Link href="/">← Dock Home</Link>
        <span>District Admin</span>
        <Link href="/owner">Dock HQ</Link>
      </div>
      <AdminPage />
    </>
  )
}
