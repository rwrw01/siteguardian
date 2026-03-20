import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Site Guardian',
  description: 'Website compliance scanner voor Nederlandse publieke instellingen',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  );
}
