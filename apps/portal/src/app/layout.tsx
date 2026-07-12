import './globals.css';
import type { Metadata } from 'next';
import localFont from 'next/font/local';

// Self-hosted (Spec §10 CSP: font-src 'self'). Same type system as the internal app
// so both surfaces read as one product; the shared Tailwind preset reads these vars.
const sans = localFont({
  src: './fonts/PlusJakartaSans.woff2',
  variable: '--font-sans',
  weight: '200 800',
  display: 'swap',
});

const mono = localFont({
  src: './fonts/JetBrainsMono.woff2',
  variable: '--font-mono',
  weight: '400',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Rademics — Client Portal',
  description: 'Project progress, deliverables & invoices',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
