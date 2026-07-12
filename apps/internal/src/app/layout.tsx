import './globals.css';
import type { Metadata } from 'next';
import localFont from 'next/font/local';

// Self-hosted (Spec §10 CSP: font-src 'self'). Plus Jakarta Sans carries the whole
// UI; JetBrains Mono is for numbers, IDs and codes. Both expose CSS variables the
// shared Tailwind preset reads (fontFamily.sans / .mono).
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
  title: 'Rademics ERP',
  description: 'Work Management & Employee Monitoring Platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
