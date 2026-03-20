import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Route Handler body size limit (기본값 10MB) — 대용량 비디오 업로드 허용
    proxyClientMaxBodySize: 2 * 1024 * 1024 * 1024, // 2GB
  },
};

export default nextConfig;
