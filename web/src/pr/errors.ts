/** Human-readable message for anything thrown (ApiRequestError, Error, or a stray value). */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
