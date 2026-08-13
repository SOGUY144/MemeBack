import type { Metadata, Viewport } from 'next';
import './globals.css';

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
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
