import { NextResponse, type NextRequest } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth/get-authenticated-user";
import { verifyGitHubInstallationState } from "@/lib/github-app/auth";
import { GitHubAppClient } from "@/lib/github-app/client";
import { getGitHubAppConfig } from "@/lib/github-app/config";
import { saveGitHubInstallation } from "@/lib/github-app/installations";

export const runtime = "nodejs";

const parseInstallationId = (value: string | null): number | null => {
  if (!value || !/^[1-9][0-9]*$/u.test(value)) {
    return null;
  }

  const installationId = Number(value);
  return Number.isSafeInteger(installationId) ? installationId : null;
};

const redirectWithResult = ({
  request,
  result,
  returnTo = "/dashboard",
}: {
  request: NextRequest;
  result: "connected" | "error";
  returnTo?: string;
}) => {
  const redirectUrl = new URL(returnTo, request.url);
  redirectUrl.searchParams.set("github_app", result);
  return NextResponse.redirect(redirectUrl);
};

export const GET = async (request: NextRequest) => {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  const code = request.nextUrl.searchParams.get("code");
  const installationId = parseInstallationId(
    request.nextUrl.searchParams.get("installation_id"),
  );
  const state = request.nextUrl.searchParams.get("state");

  if (!code || !installationId || !state) {
    return redirectWithResult({ request, result: "error" });
  }

  const config = getGitHubAppConfig();
  let returnTo = "/dashboard";

  try {
    const verifiedState = verifyGitHubInstallationState({
      expectedUserId: user.id,
      secret: config.stateSecret,
      state,
    });
    returnTo = verifiedState.returnTo;
    const installation = await new GitHubAppClient({
      config,
    }).verifyUserInstallation({
      code,
      installationId,
    });

    await saveGitHubInstallation({
      installation,
      userId: user.id,
    });

    return redirectWithResult({
      request,
      result: "connected",
      returnTo,
    });
  } catch {
    return redirectWithResult({
      request,
      result: "error",
      returnTo,
    });
  }
};
