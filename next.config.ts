import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The newspaper is a fully static snapshot — export it as plain files.
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
