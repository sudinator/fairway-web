/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep builds predictable in small CI/preview containers. Next can otherwise
  // spawn too many static-generation workers, which caused local validation hangs.
  experimental: { cpus: 1 },
  async headers() {
    return [
      {
        // Baseline browser security headers, app-wide (security review, Aug 2026).
        // A full CSP is deliberately NOT included here — with the app's inline styles it needs
        // its own carefully tested pass (tracked in BACKLOG) rather than a drive-by.
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        // The service worker must never be HTTP-cached, or the browser won't
        // notice new versions — which breaks the update prompt. Force revalidation.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },

      {
        source: "/app-version.json",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
    ];
  },
};

export default nextConfig;
