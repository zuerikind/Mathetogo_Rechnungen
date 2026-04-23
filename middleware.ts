import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api/auth") || pathname.startsWith("/login")) {
    return NextResponse.next();
  }

  if (!req.auth) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  const allowedEmail = process.env.ALLOWED_EMAIL;
  if (allowedEmail && req.auth.user?.email !== allowedEmail) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    /*
     * Skip Next internals + static files in /public (logos, icons, PDFs, etc.).
     * Otherwise middleware redirects image requests to /login and next/image fails.
     */
    "/((?!_next/static|_next/image|favicon.ico|icon\\.png|.*\\.(?:png|jpg|jpeg|webp|svg|ico|gif|pdf|txt|xml|json|woff2?)$).*)",
  ],
};
