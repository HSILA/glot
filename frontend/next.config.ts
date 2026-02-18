import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    // Docker (NODE_ENV=production) uses service name "backend"
    // Local dev (NODE_ENV=development) uses localhost
    // This works because: bun run dev → next dev → NODE_ENV=development
    const backendUrl = process.env.NODE_ENV === "production" 
      ? "http://backend:8000" 
      : "http://localhost:8000";
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
