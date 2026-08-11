/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    useWasmBinary: true
  },
  transpilePackages: [
    "@deviceops/contracts",
    "@deviceops/core",
    "@deviceops/db",
    "@deviceops/policy",
    "@deviceops/ai",
    "@deviceops/retrieval",
    "@deviceops/observability",
    "@deviceops/media"
  ],
  webpack(config) {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".js"],
      ".mjs": [".mts", ".mjs"]
    };
    return config;
  }
};

export default nextConfig;
