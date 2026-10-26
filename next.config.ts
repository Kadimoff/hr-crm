import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev serverə lokal şəbəkədən IP ilə daxil olmaq üçün (vergüllə: DEV_ORIGINS="10.0.1.164,100.69.63.70")
  allowedDevOrigins: (process.env.DEV_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  serverExternalPackages: ["exceljs", "bullmq", "ioredis"],
  experimental: {
    serverActions: { bodySizeLimit: "50mb" },
  },
};

export default nextConfig;
