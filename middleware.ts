import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api/auth") || pathname.startsWith("/login")) {
    return NextResponse.next();
  }

  if (!req.auth) {
    // API-Routen bekommen 401 statt einer Weiterleitung: fetch folgt Redirects
    // automatisch, und die Login-Seite antwortet mit 200. Ein Aufruf mit
    // abgelaufener Sitzung sah dadurch wie ein Erfolg aus — die Oberflaeche
    // haette eine nie ausgefuehrte Aktion als erledigt gemeldet.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
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
