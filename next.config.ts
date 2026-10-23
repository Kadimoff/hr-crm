import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["exceljs", "bullmq", "ioredis"],
  experimental: {
    serverActions: { bodySizeLimit: "50mb" },
  },
};

export default nextConfig;
