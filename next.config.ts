import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No `output: "standalone"`: it emits its own server.js, which cannot host
  // the WebSocket endpoint. server/index.mjs runs Next instead.

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
