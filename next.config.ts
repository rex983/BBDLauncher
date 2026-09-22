import type { NextConfig } from "next";

// Content-Security-Policy: locks down script/style/frame origins. Next.js +
// Tailwind + shadcn need 'unsafe-inline' for hydration scripts and inline
// styles. connect-src includes Supabase (data + realtime + storage) which is
// the only external origin the client talks to. form-action allows https:
// because the SAML auto-submit form posts to external SP ACS URLs.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://accounts.google.com",
  "frame-ancestors 'none'",
  "frame-src 'self' https://accounts.google.com",
  "form-action 'self' https:",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // @react-pdf/renderer ships PDFKit's .afm font files that need to be
  // resolvable at runtime. Bundling breaks them on Vercel — mark as
  // external so the serverless function loads them from node_modules.
  serverExternalPackages: ["@react-pdf/renderer"],

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "X-DNS-Prefetch-Control",
            value: "off",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          {
            key: "Content-Security-Policy",
            value: csp,
          },
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
