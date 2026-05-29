const defaultBasePath = process.env.VERCEL_ENV === "preview"
  ? ""
  : "/us/cliff-watch";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH !== undefined
  ? process.env.NEXT_PUBLIC_BASE_PATH
  : defaultBasePath;
const devApiOrigin = process.env.CLIFF_WATCH_DEV_API_ORIGIN
  || "http://127.0.0.1:8000";
const isDev = process.env.NODE_ENV === "development";

const nextConfig = {
  ...(basePath ? { basePath } : {}),
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
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

export default nextConfig;
