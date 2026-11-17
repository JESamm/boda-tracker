import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './styles.css';

export const metadata: Metadata = {
  title: {
    default: 'Boda-Tracker | SACCO Operations',
    template: '%s | Boda-Tracker',
  },
  description: 'A preview of the Boda-Tracker SACCO administration workspace.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
