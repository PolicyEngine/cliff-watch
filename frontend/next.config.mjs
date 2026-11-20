import { randomUUID } from "node:crypto";
import nextConstants from "next/constants.js";
import { materializeSampleCurves } from "./scripts/materializeSampleCurves.mjs";

const defaultBasePath = process.env.VERCEL_ENV === "preview"
  ? ""
  : "/us/cliffwatch";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH !== undefined
  ? process.env.NEXT_PUBLIC_BASE_PATH
  : defaultBasePath;
const devApiOrigin = process.env.CLIFF_WATCH_DEV_API_ORIGIN
  || "http://127.0.0.1:8000";
const isDev = process.env.NODE_ENV === "development";

const nextConfig = {
  ...(basePath ? { basePath } : {}),
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_SERIES_BUILD: process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || randomUUID(),
  },
  ...(isDev ? {} : { output: "export" }),
  trailingSlash: true,
  assetPrefix: basePath || undefined,
  ...(isDev
    ? {
        async rewrites() {
          return [
            {
              source: "/api/:path*",
              destination: `${devApiOrigin}/api/:path*`,
              basePath: false,
            },
            {
              source: "/api/:path*",
              destination: `${devApiOrigin}/api/:path*`,
            },
          ];
        },
      }
    : {}),
};

export default function config(phase) {
  if (phase === nextConstants.PHASE_DEVELOPMENT_SERVER || phase === nextConstants.PHASE_PRODUCTION_BUILD) {
    materializeSampleCurves();
  }
  return nextConfig;
}
