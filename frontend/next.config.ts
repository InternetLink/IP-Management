import type {NextConfig} from "next";

const nextConfig: NextConfig = {
  devIndicators: {
    position: "bottom-right",
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://127.0.0.1:3001/api/:path*",
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        hostname: "heroui-assets.nyc3.cdn.digitaloceanspaces.com",
        protocol: "https",
      },
      {
        hostname: "img.heroui.chat",
        protocol: "https",
      },
    ],
  },
};

export default nextConfig;
