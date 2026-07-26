"use server";

import { redirect } from "next/navigation";

import { getAuthenticatedUser } from "@/lib/auth/get-authenticated-user";
import {
  createPinchPayer,
  createPinchPaymentSource,
  PinchApiError,
} from "@/lib/pinch/client";
import { createClient } from "@/lib/supabase/server";

export type BillingSetupState = {
  message: string | null;
  status: "error" | null;
};

const getRequiredText = (
  formData: FormData,
  field: string,
  maximumLength: number,
) => {
  const value = String(formData.get(field) ?? "").trim();

  if (!value || value.length > maximumLength) {
    return null;
  }

  return value;
};

const getOptionalText = (
  formData: FormData,
  field: string,
  maximumLength: number,
) => {
  const value = String(formData.get(field) ?? "").trim();

  if (value.length > maximumLength) {
    return null;
  }

  return value;
};

const getSourceExpiry = (expiryDate: string | null) => {
  if (!expiryDate) {
    return { expiryMonth: null, expiryYear: null };
  }

  const parsedExpiryDate = new Date(expiryDate);

  if (Number.isNaN(parsedExpiryDate.getTime())) {
    return { expiryMonth: null, expiryYear: null };
  }

  return {
    expiryMonth: parsedExpiryDate.getUTCMonth() + 1,
    expiryYear: parsedExpiryDate.getUTCFullYear(),
  };
};

const getSetupErrorMessage = (error: unknown) => {
  if (error instanceof PinchApiError) {
    return "Pinch could not create the sandbox billing profile. Generate a new test card token and try again.";
  }

  return "Billing setup could not be completed. Check the database migration and try again.";
};

export const completeSandboxBillingSetup = async (
  _previousState: BillingSetupState,
  formData: FormData,
): Promise<BillingSetupState> => {
  const user = await getAuthenticatedUser();

  if (!user?.email) {
    return {
      message: "Your session has expired. Sign in and try again.",
      status: "error",
    };
  }

  const firstName = getRequiredText(formData, "firstName", 100);
  const lastName = getRequiredText(formData, "lastName", 100);
  const companyName = getOptionalText(formData, "companyName", 160);
  const captureToken = getRequiredText(formData, "captureToken", 2000);

  if (!firstName || !lastName || companyName === null) {
    return {
      message: "Enter your first and last name. Company name is optional.",
      status: "error",
    };
  }

  if (!captureToken?.startsWith("tkn_")) {
    return {
      message: "The Pinch test card token is missing. Refresh and try again.",
      status: "error",
    };
  }

  const supabase = await createClient();
  const { error: profileError } = await supabase.from("profiles").upsert(
    {
      company_name: companyName || null,
      first_name: firstName,
      last_name: lastName,
      user_id: user.id,
    },
    { onConflict: "user_id" },
  );

  if (profileError) {
    return {
      message: "The billing database is not ready. Apply the payments migration and try again.",
      status: "error",
    };
  }

  const { data: existingBillingAccount, error: billingLookupError } =
    await supabase
      .from("billing_accounts")
      .select("id, provider_payer_id, status")
      .eq("user_id", user.id)
      .maybeSingle();

  if (billingLookupError) {
    return {
      message: "The billing database could not be read. Try again.",
      status: "error",
    };
  }

  if (existingBillingAccount?.status === "ready") {
    redirect("/dashboard");
  }

  try {
    let billingAccountId = existingBillingAccount?.id;
    let payerId = existingBillingAccount?.provider_payer_id;

    if (!payerId) {
      const payer = await createPinchPayer({
        companyName: companyName || undefined,
        emailAddress: user.email,
        firstName,
        lastName,
        metadata: {
          environment: "test",
          outcomesUserId: user.id,
        },
      });
      payerId = payer.id;

      const { data: savedBillingAccount, error: billingSaveError } =
        await supabase
          .from("billing_accounts")
          .upsert(
            {
              environment: "test",
              provider: "pinch",
              provider_payer_id: payerId,
              status: "pending",
              user_id: user.id,
            },
            { onConflict: "user_id" },
          )
          .select("id")
          .single();

      if (billingSaveError) {
        throw billingSaveError;
      }

      billingAccountId = savedBillingAccount.id;
    }

    if (!billingAccountId || !payerId) {
      throw new Error("Billing account could not be initialized.");
    }

    const source = await createPinchPaymentSource(payerId, captureToken);
    const { expiryMonth, expiryYear } = getSourceExpiry(source.expiryDate);
    const lastFour = source.displayCardNumber?.slice(-4) ?? null;
    const { error: sourceSaveError } = await supabase
      .from("payment_sources")
      .insert({
        billing_account_id: billingAccountId,
        card_scheme: source.cardScheme,
        display_name: source.cardHolderName,
        expiry_month: expiryMonth,
        expiry_year: expiryYear,
        is_default: true,
        last_four: lastFour,
        provider_source_id: source.id,
        source_type: source.sourceType,
        user_id: user.id,
      });

    if (sourceSaveError) {
      throw sourceSaveError;
    }

    const { error: billingReadyError } = await supabase
      .from("billing_accounts")
      .update({
        setup_completed_at: new Date().toISOString(),
        status: "ready",
      })
      .eq("id", billingAccountId)
      .eq("user_id", user.id);

    if (billingReadyError) {
      throw billingReadyError;
    }
  } catch (error) {
    return {
      message: getSetupErrorMessage(error),
      status: "error",
    };
  }

  redirect("/dashboard");
};
