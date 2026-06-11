export class AppError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly suggestion?: string;

  constructor(
    code: string,
    message: string,
    status = 400,
    suggestion?: string,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.suggestion = suggestion;
  }
}

export const toErrorResponse = (error: unknown) => {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          suggestion: error.suggestion,
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message: "Errore interno durante la generazione documentazione.",
        suggestion: "Riprova con uno zip valido o controlla i log server.",
      },
    },
  };
};
