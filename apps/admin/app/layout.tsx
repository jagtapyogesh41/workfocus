import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ShiftFocus — Attendance-Linked Focus Console',
  description: 'Pilot admin console, attendance terminal simulator, and enrolled Android device simulator.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
