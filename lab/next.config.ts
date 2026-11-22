import type { NextConfig } from "next";

// The lab has no simulation code of its own. Every scientific value comes from one of the two
// existing local backends, reached through these same-origin proxies:
//   /api/aegis/*  -> QEC-Aegis server (MidQWest-2026/dashboard/server.py, Gross code, port 8765)
//   /api/sim/*    -> MidQwest FastAPI server (~/MidQwest/dashboard/server.py, Stim/Aer/PyMatching, port 8000)
const AEGIS = process.env.AEGIS_API ?? "http://127.0.0.1:8765";
const SIM = process.env.SIM_API ?? "http://127.0.0.1:8000";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: { proxyTimeout: 120_000 },
  async rewrites() {
    return [
      { source: "/api/aegis/:path*", destination: `${AEGIS}/api/:path*` },
      { source: "/api/sim/:path*", destination: `${SIM}/api/:path*` },
      { source: "/aegis-figures/:name", destination: `${AEGIS}/figures/:name` },   // docs/figures/*.png written by aegis.figures
    ];
  },
};
export default config;
