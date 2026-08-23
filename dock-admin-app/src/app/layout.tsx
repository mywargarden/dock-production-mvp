import './globals.css'
import './owner-hq.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Dock',
  description: 'Dock for schools and district operations'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
