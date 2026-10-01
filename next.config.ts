import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // API Key 只在服务端读取，不要在这里把它注入到客户端环境变量
  env: {},
};

export default nextConfig;
