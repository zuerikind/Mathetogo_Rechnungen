/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pruef-Build neben laufendem Server: NEXT_DIST_DIR=.next-pruef npm run build (sonst .next wie immer)
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "prisma", "@react-pdf/renderer"],
    // Ensure public/ assets (logo, payment slip) are bundled into API route functions on Vercel
    outputFileTracingIncludes: {
      "/api/invoice/*": ["./public/**/*"],
      "/api/invoices/*": ["./public/**/*"],
    },
  },
};

export default nextConfig;
