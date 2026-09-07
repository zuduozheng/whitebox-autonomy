import type { NextConfig } from "next";

// Conservative, framework-agnostic response headers applied to every route.
// No Content-Security-Policy yet — that needs its own review.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  // Do not let `next dev` inject its "agent rules" block into CLAUDE.md /
  // AGENTS.md. Project guidance for AI assistants is maintained by hand in
  // CLAUDE.md; this keeps the working tree free of tool-generated churn.
  agentRules: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
