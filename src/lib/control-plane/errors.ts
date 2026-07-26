export class ControlPlaneError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly status: number;

  constructor({
    code,
    details,
    message,
    status,
  }: {
    code: string;
    details?: Record<string, unknown>;
    message: string;
    status: number;
  }) {
    super(message);
    this.name = "ControlPlaneError";
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

export const toErrorResponse = (error: unknown) => {
  if (error instanceof ControlPlaneError) {
    return Response.json(
      {
        error: {
          code: error.code,
          ...(error.details ? { details: error.details } : {}),
          message: error.message,
        },
      },
      { status: error.status },
    );
  }

  return Response.json(
    {
      error: {
        code: "internal_error",
        message: "The request could not be completed.",
      },
    },
    { status: 500 },
  );
};
