export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string | Record<string, unknown>,
  ) {
    super(typeof detail === 'string' ? detail : JSON.stringify(detail));
    this.name = 'ApiError';
  }
}
