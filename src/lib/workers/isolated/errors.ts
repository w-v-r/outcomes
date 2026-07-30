export class PermanentTaskExecutionError extends Error {
  readonly code: string;
  readonly customerMessage: string;

  constructor(code: string, customerMessage: string, internalMessage?: string) {
    super(internalMessage ?? customerMessage);
    this.name = "PermanentTaskExecutionError";
    this.code = code;
    this.customerMessage = customerMessage;
  }
}
