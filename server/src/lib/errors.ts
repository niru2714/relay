export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown, code = 'BAD_REQUEST') =>
  new AppError(400, code, message, details);
export const forbidden = (code: string, message: string, details?: unknown) =>
  new AppError(403, code, message, details);
export const notFound = (what: string, id?: unknown) =>
  new AppError(
    404,
    'NOT_FOUND',
    `${what} not found`,
    id === undefined ? undefined : { id: String(id) },
  );
export const conflict = (code: string, message: string, details?: unknown) =>
  new AppError(409, code, message, details);
export const unprocessable = (code: string, message: string, details?: unknown) =>
  new AppError(422, code, message, details);
