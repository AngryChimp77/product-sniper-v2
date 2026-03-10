import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const PRO_ROUTES = ["/analyze", "/history"];

const IS_PRO_COOKIE = "is_pro";
const IS_PRO_MAX_AGE = 60 * 60 * 24; // 24 hours

function setIsProCookie(response: NextResponse, isPro: boolean) {
  response.cookies.set(IS_PRO_COOKIE, isPro ? "true" : "false", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    sameSite: "lax",
    maxAge: IS_PRO_MAX_AGE,
  });
  return response;
}

function getProjectRef(supabaseUrl: string): string | null {
  try {
    const u = new URL(supabaseUrl);
    const match = u.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  const isProRoute = PRO_ROUTES.some((route) => pathname.startsWith(route));

  if (!isProRoute) {
    return NextResponse.next();
  }

  // Quick check: use cached subscription status when present
  const cachedIsPro = req.cookies.get(IS_PRO_COOKIE)?.value;
  if (cachedIsPro === "true") {
    return NextResponse.next();
  }
  if (cachedIsPro === "false") {
    return NextResponse.redirect(new URL("/upgrade", req.url));
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.redirect(new URL("/upgrade", req.url));
  }

  const projectRef = getProjectRef(supabaseUrl);
  if (!projectRef) {
    return NextResponse.redirect(new URL("/upgrade", req.url));
  }

  const cookieName = `sb-${projectRef}-auth-token`;
  const cookieValue = req.cookies.get(cookieName)?.value;
  if (!cookieValue) {
    return NextResponse.redirect(new URL("/upgrade", req.url));
  }

  let accessToken: string | undefined;
  try {
    const parsed = JSON.parse(cookieValue) as { access_token?: string };
    accessToken = parsed.access_token;
  } catch {
    return NextResponse.redirect(new URL("/upgrade", req.url));
  }

  if (!accessToken) {
    return NextResponse.redirect(new URL("/upgrade", req.url));
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);

  if (authError || !user) {
    return NextResponse.redirect(new URL("/upgrade", req.url));
  }

  const { data: userRecord, error: dbError } = await supabase
    .from("users")
    .select("is_pro")
    .eq("id", user.id)
    .single();

  if (dbError || !userRecord?.is_pro) {
    const redirect = NextResponse.redirect(new URL("/upgrade", req.url));
    setIsProCookie(redirect, false);
    return redirect;
  }

  const response = NextResponse.next();
  setIsProCookie(response, userRecord.is_pro);
  return response;
}

export const config = {
  matcher: ["/analyze/:path*", "/history/:path*"],
};
