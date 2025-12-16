import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
  devIndicators: false,
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
