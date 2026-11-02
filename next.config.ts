import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev serverə lokal şəbəkədən IP ilə daxil olmaq üçün (vergüllə: DEV_ORIGINS="10.0.1.164,100.69.63.70")
  allowedDevOrigins: (process.env.DEV_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  serverExternalPackages: ["exceljs", "bullmq", "ioredis"],
  poweredByHeader: false,
  // Təhlükəsizlik başlıqları: klikcekinq (iframe yalnız eyni mənbədən — dosyedə sənəd önizləməsi üçün), MIME sniffing, referer sızması
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  experimental: {
    serverActions: { bodySizeLimit: "50mb" },
  },
};

export default nextConfig;
