"use client";

import { createBrowserClient } from "@supabase/ssr";

import { supabaseConfig } from "@/lib/supabase/config";

export const createClient = () =>
  createBrowserClient(supabaseConfig.url, supabaseConfig.publishableKey);
