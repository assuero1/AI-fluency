import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  const isAudioRoute = request.method === "GET" && /^\/api\/voice\/[a-f0-9]{64}$/.test(request.nextUrl.pathname);
  if (request.nextUrl.pathname.startsWith("/api/") && !isAudioRoute) {
    response.headers.set("Cache-Control", "no-store, max-age=0");
  }
  if (process.env.APP_ENV === "qa") response.headers.set("X-AI-Fluency-Environment", "qa");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
