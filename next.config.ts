import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module — keep it external so the bundler doesn't try to
  // pack the .node binary (it's required at runtime from node_modules).
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
