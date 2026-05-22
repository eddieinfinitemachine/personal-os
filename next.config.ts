import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";
import pkg from "./package.json" with { type: "json" };

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
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_BUILD_TIME:
      process.env.VERCEL_GIT_COMMIT_DATE || new Date().toISOString(),
  },
};

export default withSerwist(config);
