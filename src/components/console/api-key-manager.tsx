"use client";

import { useActionState } from "react";

import {
  createApiKeyAction,
  revokeApiKeyAction,
  type ApiKeyActionState,
} from "@/app/(console)/dashboard/api-key-actions";
import { type ApiKeySummary } from "@/lib/api-keys/service";

const initialState: ApiKeyActionState = {
  createdKey: null,
  message: null,
  status: null,
};

const formatDate = (value: string | null) => {
  if (!value) {
    return "Never";
  }

  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
};

export const ApiKeyManager = ({
  apiKeys,
  mcpEndpoint,
}: {
  apiKeys: ApiKeySummary[];
  mcpEndpoint: string;
}) => {
  const [createState, createAction, isCreating] = useActionState(
    createApiKeyAction,
    initialState,
  );
  const [revokeState, revokeAction, isRevoking] = useActionState(
    revokeApiKeyAction,
    initialState,
  );
  const mcpConfiguration = JSON.stringify(
    {
      mcpServers: {
        outcomes: {
          headers: {
            Authorization: "Bearer ${env:OUTCOMES_API_KEY}",
          },
          url: mcpEndpoint,
        },
      },
    },
    null,
    2,
  );

  return (
    <section
      aria-labelledby="api-key-heading"
      className="mt-16 border border-paper/15 bg-paper/[0.025]"
    >
      <div className="grid gap-8 border-b border-paper/15 p-6 sm:p-8 lg:grid-cols-[1fr_0.9fr]">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-paper/35">
            Customer authentication
          </p>
          <h2
            className="mt-4 text-3xl tracking-[-0.045em]"
            id="api-key-heading"
          >
            Outcomes API keys
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-paper/50">
            Keys connect REST and MCP requests to this customer and their Pinch
            sandbox payer. Secret values are stored only as SHA-256 hashes.
          </p>
        </div>

        <form action={createAction} className="self-end">
          <label
            className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper/40"
            htmlFor="api-key-name"
          >
            Key name
          </label>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <input
              className="min-h-11 flex-1 border border-paper/20 bg-transparent px-4 text-sm text-paper outline-none placeholder:text-paper/25 focus:border-cobalt"
              id="api-key-name"
              maxLength={80}
              name="name"
              placeholder="Hackathon demo"
              required
              type="text"
            />
            <button
              className="min-h-11 bg-cobalt px-5 text-sm font-medium text-white transition-colors hover:bg-[#4254ff] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cobalt disabled:cursor-wait disabled:opacity-60"
              disabled={isCreating}
              type="submit"
            >
              {isCreating ? "Creating…" : "Create key"}
            </button>
          </div>
        </form>
      </div>

      {createState.createdKey ? (
        <div className="border-b border-cobalt/35 bg-cobalt/10 p-6 sm:p-8">
          <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-cobalt">
            Copy once
          </p>
          <code className="mt-3 block overflow-x-auto border border-cobalt/25 bg-ink/60 p-4 font-mono text-xs text-paper">
            {createState.createdKey}
          </code>
          <p className="mt-3 text-sm text-paper/55" role="status">
            {createState.message}
          </p>
        </div>
      ) : createState.message ? (
        <p
          className="border-b border-paper/15 px-6 py-4 text-sm text-paper/60 sm:px-8"
          role={createState.status === "error" ? "alert" : "status"}
        >
          {createState.message}
        </p>
      ) : null}

      <div className="grid lg:grid-cols-[1fr_1fr]">
        <div className="border-b border-paper/15 p-6 sm:p-8 lg:border-b-0 lg:border-r">
          <h3 className="font-mono text-[9px] uppercase tracking-[0.2em] text-paper/35">
            Issued keys
          </h3>
          {apiKeys.length === 0 ? (
            <p className="mt-5 text-sm text-paper/45">
              No keys have been issued.
            </p>
          ) : (
            <ul className="mt-5 space-y-3">
              {apiKeys.map((apiKey) => (
                <li
                  className="flex flex-col gap-4 border border-paper/10 p-4 sm:flex-row sm:items-center sm:justify-between"
                  key={apiKey.id}
                >
                  <div>
                    <p className="text-sm text-paper">{apiKey.name}</p>
                    <p className="mt-1 font-mono text-[10px] text-paper/35">
                      •••• {apiKey.lastFour} / Last used{" "}
                      {formatDate(apiKey.lastUsedAt)}
                    </p>
                  </div>
                  {apiKey.revokedAt ? (
                    <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-coral">
                      Revoked
                    </span>
                  ) : (
                    <form action={revokeAction}>
                      <input
                        name="apiKeyId"
                        type="hidden"
                        value={apiKey.id}
                      />
                      <button
                        className="border-b border-paper/25 pb-1 text-xs text-paper/55 hover:border-coral hover:text-coral focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-coral disabled:opacity-50"
                        disabled={isRevoking}
                        type="submit"
                      >
                        Revoke
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          {revokeState.message ? (
            <p
              className="mt-4 text-sm text-paper/55"
              role={revokeState.status === "error" ? "alert" : "status"}
            >
              {revokeState.message}
            </p>
          ) : null}
        </div>

        <div className="p-6 sm:p-8">
          <h3 className="font-mono text-[9px] uppercase tracking-[0.2em] text-paper/35">
            Cursor mcp.json
          </h3>
          <p className="mt-4 text-sm leading-relaxed text-paper/45">
            Set the key in your environment as OUTCOMES_API_KEY, then reference
            it without committing the secret.
          </p>
          <pre className="mt-5 overflow-x-auto border border-paper/10 bg-ink/60 p-4 font-mono text-[11px] leading-relaxed text-paper/65">
            {mcpConfiguration}
          </pre>
        </div>
      </div>
    </section>
  );
};
