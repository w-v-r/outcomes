"use server";

import { revalidatePath } from "next/cache";

import {
  createCustomerApiKey,
  revokeCustomerApiKey,
} from "@/lib/api-keys/service";
import { getAuthenticatedUser } from "@/lib/auth/get-authenticated-user";

export type ApiKeyActionState = {
  createdKey: string | null;
  message: string | null;
  status: "error" | "success" | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const createApiKeyAction = async (
  _previousState: ApiKeyActionState,
  formData: FormData,
): Promise<ApiKeyActionState> => {
  const user = await getAuthenticatedUser();
  const name = String(formData.get("name") ?? "").trim();

  if (!user) {
    return {
      createdKey: null,
      message: "Sign in before creating an API key.",
      status: "error",
    };
  }

  try {
    const apiKey = await createCustomerApiKey({
      name,
      userId: user.id,
    });

    revalidatePath("/console/api-keys");

    return {
      createdKey: apiKey.value,
      message: "Copy this key now. It will not be shown again.",
      status: "success",
    };
  } catch (error) {
    return {
      createdKey: null,
      message:
        error instanceof Error
          ? error.message
          : "The API key could not be created.",
      status: "error",
    };
  }
};

export const revokeApiKeyAction = async (
  _previousState: ApiKeyActionState,
  formData: FormData,
): Promise<ApiKeyActionState> => {
  const user = await getAuthenticatedUser();
  const apiKeyId = String(formData.get("apiKeyId") ?? "");

  if (!user || !UUID_PATTERN.test(apiKeyId)) {
    return {
      createdKey: null,
      message: "The API key could not be revoked.",
      status: "error",
    };
  }

  try {
    await revokeCustomerApiKey({
      apiKeyId,
      userId: user.id,
    });
    revalidatePath("/console/api-keys");

    return {
      createdKey: null,
      message: "API key revoked.",
      status: "success",
    };
  } catch (error) {
    return {
      createdKey: null,
      message:
        error instanceof Error
          ? error.message
          : "The API key could not be revoked.",
      status: "error",
    };
  }
};
