import type { Metadata, Viewport } from 'next';
import { Kanit } from 'next/font/google';
import './globals.css';

/**
 * Self-hosted at build time (next/font downloads once, then serves the files
 * from this app's own origin) — the classroom-offline requirement stays true
 * even though this is a "web font": no request to fonts.googleapis.com ever
 * happens at runtime, only during `next build`/`next dev`.
 */
const kanit = Kanit({
  subsets: ['thai', 'latin'],
  weight: ['400', '600', '700', '900'],
  variable: '--font-kanit',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'MemeBack — เปลี่ยนคำตอบให้เป็นมีม',
  description:
    'ครูตั้งคำถามปลายเปิด นักเรียนตอบด้วยความคิดตัวเอง AI เปลี่ยนคำตอบเป็นมีม แล้วทั้งห้องช่วยกันทาย',
};

export const viewport: Viewport = {
  themeColor: '#FFD93D',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={kanit.variable}>
      <body>{children}</body>
    </html>
  );
}
