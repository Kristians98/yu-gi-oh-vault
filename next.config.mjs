/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // scanned card images are sent to a Server Action for AI identification
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
