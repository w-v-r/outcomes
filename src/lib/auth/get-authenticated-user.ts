import { createClient } from "@/lib/supabase/server";

export type AuthenticatedUser = {
  email: string | null;
  id: string;
};

export const getAuthenticatedUser =
  async (): Promise<AuthenticatedUser | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();

    if (error || !data?.claims.sub) {
      return null;
    }

    return {
      email:
        typeof data.claims.email === "string" ? data.claims.email : null,
      id: data.claims.sub,
    };
  };
