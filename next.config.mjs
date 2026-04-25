/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "prisma", "@react-pdf/renderer"],
  },
  // Ensure public/ assets (logo, payment slip) are bundled into API route functions on Vercel
  outputFileTracingIncludes: {
    "/api/invoice/*": ["./public/**/*"],
    "/api/invoices/*": ["./public/**/*"],
  },
};

export default nextConfig;
