import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Murder Mystery',
  description: 'Web-based AI murder mystery game',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
