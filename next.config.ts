import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Emit a self-contained server bundle with only the node_modules actually
   * reached. That is what lets the runtime image be a bare node:slim with no
   * install step — a few hundred MB smaller and much faster to boot on Fly.
   */
  output: "standalone",

  // Client source maps would serve readable app code from production. Nothing
  // secret is compiled into the bundle, but there is no reason to publish it.
  productionBrowserSourceMaps: false,
};

export default nextConfig;
