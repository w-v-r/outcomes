export type StartedVerification = {
  runId: number;
  url: string;
};

export type RefreshedVerification = {
  conclusion: string | null;
  status: "queued" | "in_progress" | "completed";
  url: string;
};

export interface VerifierAdapter {
  recoverVerification?(input: {
    dispatchedAfter: string;
    taskId: string;
  }): Promise<StartedVerification | null>;
  refreshVerification(
    runId: number,
  ): Promise<RefreshedVerification>;
  startVerification(input: {
    baselineSha: string;
    resultRef: string;
    taskId: string;
  }): Promise<StartedVerification>;
}
