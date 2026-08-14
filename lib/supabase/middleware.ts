import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PAGES = ["/login", "/auth/callback", "/reset-password", "/offline"];
const PUBLIC_FILES = ["/sw.js", "/icon.svg", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png", "/manifest.webmanifest"];

export function isPublicPath(pathname: string) {
  return PUBLIC_FILES.includes(pathname) || PUBLIC_PAGES.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export async function updateSession(request: NextRequest) {
  const url = process.env.SUPABASE_URL?.trim();
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
  let response = NextResponse.next({ request });

  // Fail-closed: sem config do Supabase nenhuma rota protegida passa —
  // páginas redirecionam para /login e APIs recebem 401 com a causa.
  if (!url || !anonKey) {
    const { pathname } = request.nextUrl;
    if (isPublicPath(pathname)) return response;
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { ok: false, error: "Supabase não configurado. Defina SUPABASE_URL e SUPABASE_ANON_KEY." },
        { status: 401 }
      );
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      }
    }
  });

  const {
    data: { user }
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  if (!user && !isPublicPath(pathname)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ ok: false, error: "Não autenticado." }, { status: 401 });
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }
  if (user && pathname === "/login") {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    return NextResponse.redirect(homeUrl);
  }

  return response;
}
