import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const PRO_ROUTES = ["/analyze", "/history"];

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
    return NextResponse.redirect(new URL("/upgrade", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/analyze/:path*", "/history/:path*"],
};
