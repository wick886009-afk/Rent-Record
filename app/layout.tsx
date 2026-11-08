import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RentFlow — Automated Rent & Tenant Management System 2026',
  description: 'Premium Property Management SaaS connected to Google Sheets with Single-Page A4 PDF Rent Slips.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#FAF8F5] text-[#1E293B] antialiased">
        {children}
      </body>
    </html>
  );
}
