import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ApiKeyManager } from "@/components/console/api-key-manager";
import { PageHeader } from "@/components/console/page-header";
import { listCustomerApiKeys } from "@/lib/api-keys/service";
import { getAuthenticatedUser } from "@/lib/auth/get-authenticated-user";

export const metadata: Metadata = {
  title: "API keys",
};

const ApiKeysPage = async () => {
  const user = await getAuthenticatedUser();

  if (!user) {
    redirect("/sign-in");
  }

  const apiKeys = await listCustomerApiKeys(user.id).catch(() => []);

  return (
    <>
      <PageHeader
        description="Keys used to authenticate API and MCP requests."
        title="API keys"
      />
      <div className="max-w-5xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <ApiKeyManager apiKeys={apiKeys} />
      </div>
    </>
  );
};

export default ApiKeysPage;
