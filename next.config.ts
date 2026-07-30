import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@cursor/sdk"],
  transpilePackages: ["@outcomes/contracts"],
};

export default nextConfig;
