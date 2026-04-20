/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "prisma", "@react-pdf/renderer"],
  },
};

export default nextConfig;
