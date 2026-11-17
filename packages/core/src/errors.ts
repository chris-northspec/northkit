/** Base for errors the web layer turns into a user-facing message. */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The record doesn't exist or is outside the caller's site scope (deliberately the same). */
export class NotFoundError extends DomainError {}

/** The caller is signed in but lacks the permission. */
export class ForbiddenError extends DomainError {}

/** Someone else changed the record first (row_version mismatch), or a unique key clashed. */
export class ConflictError extends DomainError {}

export class ValidationError extends DomainError {
  constructor(
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}
