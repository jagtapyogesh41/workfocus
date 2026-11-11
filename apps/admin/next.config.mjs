/** @type {import('next').NextConfig} */
const apiTarget = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/v1/:path*',
        destination: `${apiTarget}/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
