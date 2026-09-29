/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // scanned card images are sent to a Server Action for AI identification
    serverActions: { bodySizeLimit: "4mb" },
    // Client router cache: a page you visited in the last 30s re-opens instantly from
    // memory instead of a round-trip to Vercel + Supabase. Mutations still refresh it:
    // server actions call revalidatePath (which purges this cache) and <Realtime> runs
    // router.refresh() every 30s on the open page.
    staleTimes: { dynamic: 30, static: 300 },
  },
};

export default nextConfig;
