/** What a server action hands back to its form. Never contains passwords. */
export interface FormState {
  /** Form-level error, shown at the top and focused. */
  error?: string;
  /** Per-field messages, keyed by input name. */
  fields?: Record<string, string>;
  /** Confirmation shown after a successful save that stays on the page. */
  message?: string;
  /** What was typed, so the form shows it again after an error. */
  values?: Record<string, string>;
  /** Anything else the page needs to show after the action (e.g. a preview). */
  data?: unknown;
}

export const EMPTY_FORM: FormState = {};
