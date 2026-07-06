
import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dock Admin',
  description: 'Manage district workspaces for Dock'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
