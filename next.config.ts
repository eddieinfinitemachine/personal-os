import type { NextConfig } from "next";
import { execSync } from "node:child_process";
import withSerwistInit from "@serwist/next";
import pkg from "./package.json" with { type: "json" };

// Version = git commit count, so the sidebar footer ticks up with every
// deploy ("v0.151"). Shallow clones (some CI) yield tiny counts — fall back
// to the short SHA, then to package.json.
function buildVersion(): string {
  try {
    const count = Number(execSync("git rev-list --count HEAD").toString().trim());
    if (count > 50) return `0.${count}`;
  } catch {}
  const sha = (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7);
  return sha ? `${pkg.version}+${sha}` : pkg.version;
}

// Serwist builds the service worker that powers offline. SW only registers in
// production builds (disabled in dev so HMR isn't intercepted).
const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  cacheOnNavigation: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development",
});

const config: NextConfig = {
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
      },
    ],
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: buildVersion(),
    NEXT_PUBLIC_BUILD_TIME:
      process.env.VERCEL_GIT_COMMIT_DATE || new Date().toISOString(),
  },
};

export default withSerwist(config);
