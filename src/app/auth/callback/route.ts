import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

const getSafeNextPath = (nextPath: string | null) => {
  if (!nextPath?.startsWith("/") || nextPath.startsWith("//")) {
    return "/dashboard";
  }

  return nextPath;
};

export const GET = async (request: NextRequest) => {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const nextPath = getSafeNextPath(requestUrl.searchParams.get("next"));
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProtocol = request.headers.get("x-forwarded-proto") ?? "https";
  const redirectOrigin =
    process.env.NODE_ENV === "development" || !forwardedHost
      ? requestUrl.origin
      : `${forwardedProtocol}://${forwardedHost}`;

  if (!code) {
    return NextResponse.redirect(
      new URL("/sign-in?error=missing-code", redirectOrigin),
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL("/sign-in?error=invalid-code", redirectOrigin),
    );
  }

  return NextResponse.redirect(new URL(nextPath, redirectOrigin));
};
