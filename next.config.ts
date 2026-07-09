import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow large base64 image payloads (progress photos) through server actions/routes.
  experimental: {
    serverActions: { bodySizeLimit: "12mb" },
  },
  // The plan routes read these datasets with fs at runtime; without explicit
  // tracing Vercel leaves them out of the function bundle (ENOENT in prod).
  outputFileTracingIncludes: {
    "/api/plan/generate": ["./src/data/*.json", "./public/exercise-library.json"],
    "/api/plan/adjust": ["./src/data/*.json", "./public/exercise-library.json"],
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
