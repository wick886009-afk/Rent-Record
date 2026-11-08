/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  env: {
    NEXT_PUBLIC_DEFAULT_SPREADSHEET_ID:
      process.env.GOOGLE_SHEETS_SPREADSHEET_ID ||
      '1_Xog1mnKtWER-KjI7oCg0n2S5UeK-KWhgQkeOTErV2s',
  },
};

export default nextConfig;
