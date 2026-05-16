import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

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
};

export default withSerwist(config);
