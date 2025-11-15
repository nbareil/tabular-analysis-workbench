import { useDataStore } from '@state/dataStore';

export interface DiagnosticPayload {
  operation?: string;
  context?: Record<string, unknown>;
  retry?: (() => Promise<unknown> | unknown) | null;
  cause?: {
    name?: string;
    message?: string;
    stack?: string;
  };
  extra?: Record<string, unknown>;
}

export interface ReportAppErrorOptions {
  operation?: string;
  context?: Record<string, unknown>;
  retry?: (() => Promise<unknown> | unknown) | null;
  extra?: Record<string, unknown>;
}

export const reportAppError = (
  message: string,
  error?: unknown,
  options: ReportAppErrorOptions = {}
): void => {
  const payload: DiagnosticPayload = {
    operation: options.operation,
    context: options.context,
    retry: options.retry ?? null,
    extra: options.extra
  };

  if (error instanceof Error) {
    payload.cause = {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  } else if (error != null) {
    payload.cause = {
      message: typeof error === 'string' ? error : undefined
    };
  }

  useDataStore.getState().setError(message, payload);
};
