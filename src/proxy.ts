import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

export const proxy = async (request: NextRequest) => updateSession(request);

export const config = {
  matcher: ["/sign-in", "/dashboard/:path*", "/auth/:path*"],
};
