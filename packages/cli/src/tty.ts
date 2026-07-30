export const isInteractiveInput = (): boolean =>
  Boolean(process.stdin.isTTY);

export const requireInteractiveApproval = (): void => {
  if (!isInteractiveInput()) {
    throw new Error(
      "Interactive approval requires a TTY on stdin. Use --yes with the exact --contract-hash from the quote.",
    );
  }
};
