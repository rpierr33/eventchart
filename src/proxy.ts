import { auth } from "@/auth";
import { NextResponse } from "next/server";

const PROTECTED_PATHS = ["/dashboard"];

export default auth((req) => {
  const { nextUrl } = req;
  const isProtected = PROTECTED_PATHS.some((p) => nextUrl.pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();

  if (!req.auth) {
    const url = new URL("/login", nextUrl);
    url.searchParams.set("next", nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/dashboard/:path*"],
};
