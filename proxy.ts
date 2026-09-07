import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";
import { NextResponse } from "next/server";
import {
  CHANGE_CREDENTIALS_PATH,
  mustRedirectToChangeCredentials,
} from "@/lib/domain/credentials";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const path = req.nextUrl.pathname;
  const isProtected =
    path.startsWith("/admin") ||
    path.startsWith("/driver") ||
    path.startsWith("/account");

  if (isProtected && !req.auth) {
    const url = new URL("/sign-in", req.nextUrl.origin);
    url.searchParams.set("callbackUrl", path);
    return NextResponse.redirect(url);
  }

  if (
    req.auth &&
    mustRedirectToChangeCredentials(
      path,
      Boolean(req.auth.user?.mustChangeCredentials),
    )
  ) {
    return NextResponse.redirect(new URL(CHANGE_CREDENTIALS_PATH, req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/admin",
    "/admin/:path*",
    "/driver",
    "/driver/:path*",
    "/account",
    "/account/:path*",
  ],
};
