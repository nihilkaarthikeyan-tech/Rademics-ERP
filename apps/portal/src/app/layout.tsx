import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Rademics — Client Portal',
  description: 'Project progress, deliverables & invoices',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
