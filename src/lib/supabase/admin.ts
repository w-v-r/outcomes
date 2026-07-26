import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { supabaseConfig } from "@/lib/supabase/config";

export const createAdminClient = () => {
  const secretKey =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!secretKey) {
    return null;
  }

  return createSupabaseClient(supabaseConfig.url, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
};
