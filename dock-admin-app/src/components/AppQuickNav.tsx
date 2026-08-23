'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function AppQuickNav() {
  const pathname = usePathname()
  if (!pathname || pathname === '/') return null

  return (
    <div className="appQuickNav" aria-label="Dock navigation">
      <Link href="/" title="Dock home">⌂ <span>Home</span></Link>
      <Link href="/owner" title="Dock HQ">◆ <span>HQ</span></Link>
      <Link href="/owner/themes" title="Theme Studio">✦ <span>Themes</span></Link>
    </div>
  )
}
