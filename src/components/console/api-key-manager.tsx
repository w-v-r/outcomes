"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  createApiKeyAction,
  revokeApiKeyAction,
  type ApiKeyActionState,
} from "@/app/(console)/console/api-keys/actions";
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
}: {
  apiKeys: ApiKeySummary[];
}) => {
  const [createState, createAction, isCreating] = useActionState(
    createApiKeyAction,
    initialState,
  );
  const [revokeState, revokeAction, isRevoking] = useActionState(
    revokeApiKeyAction,
    initialState,
  );
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<
    "copied" | "error" | "idle"
  >("idle");
  const createdKey = createState.createdKey;

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog) {
      return;
    }

    if (createdKey && createdKey !== dismissedKey && !dialog.open) {
      setCopyStatus("idle");
      dialog.showModal();
    }
  }, [createdKey, dismissedKey]);

  const handleCloseKeyDialog = () => {
    setDismissedKey(createdKey);
    setCopyStatus("idle");
    dialogRef.current?.close();
  };

  const handleCopyKey = async () => {
    if (!createdKey) {
      return;
    }

    try {
      await navigator.clipboard.writeText(createdKey);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  };

  return (
    <section aria-labelledby="api-key-heading">
      <div className="flex flex-col justify-between gap-6 border-b border-paper/10 pb-6 sm:flex-row sm:items-end">
        <div>
          <h2 className="text-sm font-medium text-paper" id="api-key-heading">
            Keys
          </h2>
          <p className="mt-1 text-xs text-paper/40">
            Secret values are shown once when created.
          </p>
        </div>

        <form action={createAction} className="flex w-full gap-2 sm:w-auto">
          <label className="sr-only" htmlFor="api-key-name">
            Key name
          </label>
          <input
            className="min-h-9 min-w-0 flex-1 rounded-md border border-paper/15 bg-paper/[0.035] px-3 text-sm text-paper outline-none placeholder:text-paper/30 focus:border-cobalt sm:w-48"
            id="api-key-name"
            maxLength={80}
            name="name"
            placeholder="Key name"
            required
            type="text"
          />
          <button
            className="min-h-9 whitespace-nowrap rounded-md bg-paper px-3.5 text-xs font-medium text-ink transition-colors hover:bg-paper/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt disabled:cursor-wait disabled:opacity-60"
            disabled={isCreating}
            type="submit"
          >
            {isCreating ? "Creating…" : "Create key"}
          </button>
        </form>
      </div>

      {createState.message && !createState.createdKey ? (
        <p
          className="my-5 text-sm text-paper/45"
          role={createState.status === "error" ? "alert" : "status"}
        >
          {createState.message}
        </p>
      ) : null}

      {apiKeys.length === 0 ? (
        <p className="border-b border-paper/10 py-10 text-center text-sm text-paper/45">
          No API keys.
        </p>
      ) : (
        <ul className="divide-y divide-paper/10 border-b border-paper/10">
          {apiKeys.map((apiKey) => (
            <li
              className="flex flex-col justify-between gap-3 py-4 sm:flex-row sm:items-center"
              key={apiKey.id}
            >
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-paper">{apiKey.name}</p>
                  {apiKey.revokedAt ? (
                    <span className="rounded bg-coral/15 px-2 py-0.5 text-[10px] font-medium text-[#ff9e87]">
                      Revoked
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 font-mono text-[10px] text-paper/35">
                  •••• {apiKey.lastFour} · Last used{" "}
                  {formatDate(apiKey.lastUsedAt)}
                </p>
              </div>
              {apiKey.revokedAt ? null : (
                <form action={revokeAction}>
                  <input name="apiKeyId" type="hidden" value={apiKey.id} />
                  <button
                    className="text-xs text-paper/40 transition-colors hover:text-[#ff9e87] focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-coral disabled:opacity-50"
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
          className="mt-4 text-sm text-paper/45"
          role={revokeState.status === "error" ? "alert" : "status"}
        >
          {revokeState.message}
        </p>
      ) : null}

      <dialog
        aria-labelledby="created-key-heading"
        className="m-auto w-[min(34rem,calc(100%-2rem))] rounded-lg border border-paper/15 bg-[#171916] p-0 text-paper shadow-2xl backdrop:bg-black/75 backdrop:backdrop-blur-[2px]"
        onCancel={handleCloseKeyDialog}
        onClose={() => setDismissedKey(createdKey)}
        ref={dialogRef}
      >
        <div className="flex items-start justify-between gap-6 border-b border-paper/10 px-5 py-4">
          <div>
            <h2
              className="text-base font-medium tracking-[-0.02em]"
              id="created-key-heading"
            >
              API key created
            </h2>
            <p className="mt-1 text-xs leading-5 text-paper/45">
              Copy this key now. It will not be shown again.
            </p>
          </div>
          <button
            aria-label="Close API key dialog"
            className="grid size-7 shrink-0 place-items-center rounded-md text-lg leading-none text-paper/45 transition-colors hover:bg-paper/[0.07] hover:text-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt"
            onClick={handleCloseKeyDialog}
            type="button"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div className="p-5">
          <code className="block break-all rounded-md border border-paper/10 bg-black/25 p-4 font-mono text-xs leading-5 text-paper">
            {createdKey}
          </code>
          <div className="mt-4 flex items-center justify-between gap-4">
            <p
              aria-live="polite"
              className="text-xs text-paper/45"
              role="status"
            >
              {copyStatus === "copied"
                ? "Copied to clipboard."
                : copyStatus === "error"
                  ? "Could not copy. Select the key manually."
                  : ""}
            </p>
            <button
              className="min-h-9 shrink-0 rounded-md bg-paper px-4 text-xs font-medium text-ink transition-colors hover:bg-paper/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt"
              onClick={handleCopyKey}
              type="button"
            >
              {copyStatus === "copied" ? "Copied" : "Copy key"}
            </button>
          </div>
        </div>
      </dialog>
    </section>
  );
};
