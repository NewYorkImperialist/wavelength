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

  /**
   * One canonical host. The session cookie is host-only, so a player who
   * joined on www. (or the old fly.dev address) and later lands on the bare
   * subdomain would lose their seat in the room.
   */
  async redirects() {
    return ["www.wavelength.jaydenlin.net", "wave-length.fly.dev"].map(
      (host) => ({
        source: "/:path*",
        has: [{ type: "host" as const, value: host }],
        destination: "https://wavelength.jaydenlin.net/:path*",
        permanent: true,
      }),
    );
  },
};

export default nextConfig;
