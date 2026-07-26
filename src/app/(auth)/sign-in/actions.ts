"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type AuthFormState = {
  message: string | null;
  status: "error" | "success" | null;
};

const getAuthErrorMessage = (errorMessage: string) => {
  const normalizedMessage = errorMessage.toLowerCase();

  if (normalizedMessage.includes("invalid login credentials")) {
    return "That email and password combination was not recognized.";
  }

  if (normalizedMessage.includes("email not confirmed")) {
    return "Confirm your email before signing in.";
  }

  if (normalizedMessage.includes("already registered")) {
    return "An account already exists for that email. Sign in instead.";
  }

  return "Authentication could not be completed. Try again.";
};

const getRequestOrigin = async () => {
  const requestHeaders = await headers();
  const origin = requestHeaders.get("origin");

  if (origin) {
    return origin;
  }

  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";

  return host ? `${protocol}://${host}` : "http://localhost:3000";
};

export const authenticate = async (
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> => {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const intent = formData.get("intent");

  if (!email || !email.includes("@")) {
    return {
      message: "Enter a valid email address.",
      status: "error",
    };
  }

  if (password.length < 8) {
    return {
      message: "Your password must contain at least 8 characters.",
      status: "error",
    };
  }

  const supabase = await createClient();

  if (intent === "sign-up") {
    const requestOrigin = await getRequestOrigin();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${requestOrigin}/auth/callback?next=/billing/setup`,
      },
    });

    if (error) {
      return {
        message: getAuthErrorMessage(error.message),
        status: "error",
      };
    }

    if (data.user?.identities?.length === 0) {
      return {
        message: "An account already exists for that email. Sign in instead.",
        status: "error",
      };
    }

    if (!data.session) {
      return {
        message:
          "Account created. Check your email to confirm it, then return to sign in.",
        status: "success",
      };
    }

    redirect("/billing/setup");
  }

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return {
      message: getAuthErrorMessage(error.message),
      status: "error",
    };
  }

  redirect("/dashboard");
};
