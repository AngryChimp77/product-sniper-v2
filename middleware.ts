import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PRO_ROUTES = ["/analyze", "/history"];

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  const isProRoute = PRO_ROUTES.some((route) => pathname.startsWith(route));

  if (!isProRoute) {
    return NextResponse.next();
  }

  const isPro = req.cookies.get("is_pro")?.value === "true";

  if (!isPro) {
    return NextResponse.redirect(new URL("/upgrade", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/analyze/:path*", "/history/:path*"],
};
