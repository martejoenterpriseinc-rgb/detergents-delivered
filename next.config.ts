import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Render's Node service uses next start. Only the Docker build uses server.js.
  output: process.env.DD_BUILD_STANDALONE === "true" ? "standalone" : undefined,
  typedRoutes: true,
};

export default nextConfig;
