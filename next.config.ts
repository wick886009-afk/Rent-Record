import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_DEFAULT_SPREADSHEET_ID: process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '1_Xog1mnKtWER-KjI7oCg0n2S5UeK-KWhgQkeOTErV2s',
  },
};

export default nextConfig;
