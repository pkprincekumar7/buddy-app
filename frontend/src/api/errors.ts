export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string | Record<string, unknown>,
  ) {
    super(typeof detail === 'string' ? detail : JSON.stringify(detail));
    this.name = 'ApiError';
  }

  /** The service's `detail.code` (e.g. `circle_locked`), when it sent one: match on this,
   *  not on the message (docs/auth-users-split-api.md, "Errors"). */
  get code(): string | undefined {
    if (typeof this.detail === 'string') return undefined;
    const code = this.detail['code'];
    return typeof code === 'string' ? code : undefined;
  }
}
