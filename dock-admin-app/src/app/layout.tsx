import './globals.css';
import './owner-hq.css';
import './managed-background-fit.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dock HQ',
  description: 'Dock owner mothership and district operations console'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
