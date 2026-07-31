import { NextResponse, type NextRequest } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth/get-authenticated-user";
import { createGitHubInstallationState } from "@/lib/github-app/auth";
import { GitHubAppClient } from "@/lib/github-app/client";
import { getGitHubAppConfig } from "@/lib/github-app/config";

export const runtime = "nodejs";

export const GET = async (request: NextRequest) => {
  const user = await getAuthenticatedUser();

  if (!user) {
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("next", "/console");
    return NextResponse.redirect(signInUrl);
  }

  const config = getGitHubAppConfig();
  const state = createGitHubInstallationState({
    returnTo: "/console",
    secret: config.stateSecret,
    userId: user.id,
  });
  const installUrl = new GitHubAppClient({ config }).createInstallUrl(state);

  return NextResponse.redirect(installUrl);
};
