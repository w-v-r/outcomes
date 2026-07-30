export {
  getBearerToken,
  maskApiKey,
  parseApiKey,
} from "./api-key.js";
export {
  CLI_EXIT,
  QUOTE_CUSTOMER_STATUSES,
  TERMINAL_TASK_STATUSES,
  apiErrorBodySchema,
  exitCodeForQuoteStatus,
  exitCodeForStatusQuery,
  exitCodeForTaskStatus,
  isTerminalTaskStatus,
  mapApiErrorToCliExit,
  type ApiErrorBody,
  type CliExitCode,
  type QuoteCustomerStatus,
  type TerminalTaskStatus,
} from "./errors.js";
export {
  githubBranchSchema,
  githubShaSchema,
  normalizeGitHubRepositoryUrl,
  parseGitHubRepository,
  sha256Schema,
  type GitHubRepository,
} from "./github.js";
export {
  customerPricingEvidenceSchema,
  type CustomerPricingEvidence,
} from "./pricing-evidence.js";
export {
  acceptQuoteInputSchema,
  bindingQuoteInputSchema,
  bindingQuoteInputShape,
  createAssessmentInputSchema,
  createQuoteInputSchema,
  legacyQuoteInputSchema,
  linearSourceInputSchema,
  repositoryCaptureRequestSchema,
  type AcceptQuoteInput,
  type BindingQuoteInput,
  type CreateAssessmentInput,
  type CreateQuoteInput,
  type LegacyQuoteInput,
  type RepositoryCaptureRequest,
} from "./requests.js";
export {
  acceptQuoteResponseSchema,
  createAssessmentResponseSchema,
  createQuoteResponseSchema,
  customerAssessmentSchema,
  customerLegacyQuoteSchema,
  customerQuoteSchema,
  customerSnapshotQuoteSchema,
  customerTaskSchema,
  getTaskResponseSchema,
  installationGenerationSchema,
  isSnapshotQuote,
  listInstallationsResponseSchema,
  repositoryCaptureResponseSchema,
  type CustomerQuote,
  type CustomerTask,
  type InstallationGeneration,
} from "./responses.js";
export {
  taskContractSchema,
  type TaskContract,
} from "./task-contract.js";

export const OUTCOMES_API_DEFAULT_BASE_URL =
  "https://outcomes-chi.vercel.app";

export const OUTCOMES_API_PATHS = {
  assessments: "/api/v1/assessments",
  acceptQuote: (quoteId: string) => `/api/v1/quotes/${quoteId}/accept`,
  installations: "/api/v1/repositories/installations",
  quotes: "/api/v1/quotes",
  repositoryBindings: "/api/v1/repository-bindings",
  task: (taskId: string) => `/api/v1/tasks/${taskId}`,
} as const;
