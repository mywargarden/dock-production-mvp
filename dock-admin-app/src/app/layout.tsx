import './globals.css'
import './quicknav.css'
import './theme-studio.css'
import type { Metadata } from 'next'
import AppQuickNav from '@/components/AppQuickNav'

export const metadata: Metadata = {
  title: 'Dock',
  description: 'Dock for schools and district operations'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppQuickNav />
        {children}
      </body>
    </html>
  )
}
