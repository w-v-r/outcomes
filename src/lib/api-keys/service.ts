import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import {
  apiKeyHashesMatch,
  generateApiKey,
  getBearerToken,
  hashApiKey,
  parseApiKey,
} from "./core";

export type CustomerPrincipal = {
  apiKeyId: string;
  userId: string;
};

export type ApiKeySummary = {
  createdAt: string;
  id: string;
  lastFour: string;
  lastUsedAt: string | null;
  name: string;
  revokedAt: string | null;
};

export class ApiAuthenticationError extends Error {
  readonly code: "missing_api_key" | "invalid_api_key" | "auth_unavailable";
  readonly status: number;

  constructor(
    code: ApiAuthenticationError["code"],
    message: string,
    status: number,
  ) {
    super(message);
    this.name = "ApiAuthenticationError";
    this.code = code;
    this.status = status;
  }
}

const requireAdminClient = () => {
  const supabase = createAdminClient();

  if (!supabase) {
    throw new ApiAuthenticationError(
      "auth_unavailable",
      "API-key authentication is not configured.",
      503,
    );
  }

  return supabase;
};

const decodeDatabaseHash = (value: unknown) => {
  if (typeof value !== "string") {
    return "";
  }

  return value.startsWith("\\x") ? value.slice(2) : value;
};

export const createCustomerApiKey = async ({
  name,
  userId,
}: {
  name: string;
  userId: string;
}) => {
  const normalizedName = name.trim();

  if (normalizedName.length < 1 || normalizedName.length > 80) {
    throw new Error("API key name must contain 1 to 80 characters.");
  }

  const generatedKey = generateApiKey();
  const supabase = requireAdminClient();
  const { data, error } = await supabase
    .from("api_keys")
    .insert({
      key_hash: `\\x${generatedKey.hashHex}`,
      last_four: generatedKey.lastFour,
      lookup_prefix: generatedKey.lookupPrefix,
      name: normalizedName,
      user_id: userId,
    })
    .select("id, created_at")
    .single();

  if (error) {
    throw new Error("The API key could not be created.", { cause: error });
  }

  return {
    createdAt: data.created_at as string,
    id: data.id as string,
    value: generatedKey.value,
  };
};

export const listCustomerApiKeys = async (
  userId: string,
): Promise<ApiKeySummary[]> => {
  const supabase = requireAdminClient();
  const { data, error } = await supabase
    .from("api_keys")
    .select(
      "id, name, last_four, created_at, last_used_at, revoked_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error("API keys could not be loaded.", { cause: error });
  }

  return (data ?? []).map((key) => ({
    createdAt: key.created_at as string,
    id: key.id as string,
    lastFour: key.last_four as string,
    lastUsedAt: (key.last_used_at as string | null) ?? null,
    name: key.name as string,
    revokedAt: (key.revoked_at as string | null) ?? null,
  }));
};

export const revokeCustomerApiKey = async ({
  apiKeyId,
  userId,
}: {
  apiKeyId: string;
  userId: string;
}) => {
  const supabase = requireAdminClient();
  const { data, error } = await supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", apiKeyId)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    throw new Error("The API key could not be revoked.", { cause: error });
  }
};

export const authenticateApiKey = async (
  value: string,
): Promise<CustomerPrincipal> => {
  const parsedKey = parseApiKey(value);

  if (!parsedKey) {
    throw new ApiAuthenticationError(
      "invalid_api_key",
      "The Outcomes API key is invalid.",
      401,
    );
  }

  const supabase = requireAdminClient();
  const { data, error } = await supabase
    .from("api_keys")
    .select("id, user_id, key_hash")
    .eq("lookup_prefix", parsedKey.lookupPrefix)
    .is("revoked_at", null)
    .maybeSingle();
  const candidateHash = hashApiKey(value);

  if (
    error ||
    !data ||
    !apiKeyHashesMatch(
      candidateHash,
      decodeDatabaseHash(data.key_hash),
    )
  ) {
    throw new ApiAuthenticationError(
      "invalid_api_key",
      "The Outcomes API key is invalid.",
      401,
    );
  }

  await supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);

  return {
    apiKeyId: data.id as string,
    userId: data.user_id as string,
  };
};

export const authenticateRequest = async (
  request: Request,
): Promise<CustomerPrincipal> => {
  const bearerToken = getBearerToken(
    request.headers.get("authorization"),
  );

  if (!bearerToken) {
    throw new ApiAuthenticationError(
      "missing_api_key",
      "Provide an Outcomes API key as a Bearer token.",
      401,
    );
  }

  return authenticateApiKey(bearerToken);
};
