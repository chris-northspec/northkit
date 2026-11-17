'use client';

import {
  createContext,
  useActionState,
  useContext,
  useEffect,
  useId,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { EMPTY_FORM, type FormState } from '@/lib/form-state';

export type FormActionFn = (state: FormState, form: FormData) => Promise<FormState>;

const StateContext = createContext<FormState>(EMPTY_FORM);

export function useFormResult(): FormState {
  return useContext(StateContext);
}

interface ActionFormProps {
  action: FormActionFn;
  submitLabel: string;
  pendingLabel?: string;
  children?: ReactNode;
  /** Extra buttons after the submit button. */
  after?: ReactNode;
  /** Rendered below the form from the latest state (e.g. a preview). */
  result?: (state: FormState) => ReactNode;
  className?: string;
  submitClassName?: string;
}

/**
 * A form wired to a server action: shows and focuses the form error, keeps typed
 * values after an error, and passes field errors to the fields inside it.
 */
export function ActionForm({
  action,
  submitLabel,
  pendingLabel,
  children,
  after,
  result,
  className,
  submitClassName,
}: ActionFormProps) {
  const [state, formAction, pending] = useActionState(action, EMPTY_FORM);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.error) errorRef.current?.focus();
    else if (state.message) messageRef.current?.focus();
  }, [state]);

  return (
    <StateContext.Provider value={state}>
      <form action={formAction} className={className ?? 'stack form'} noValidate>
        {state.error ? (
          <p className="form-error" role="alert" tabIndex={-1} ref={errorRef}>
            {state.error}
          </p>
        ) : null}
        {state.message ? (
          <p className="form-message" role="status" tabIndex={-1} ref={messageRef}>
            {state.message}
          </p>
        ) : null}
        {children}
        <div className="form-actions">
          <button
            type="submit"
            className={submitClassName ?? 'button button-primary'}
            disabled={pending}
          >
            {pending ? (pendingLabel ?? 'Saving…') : submitLabel}
          </button>
          {after}
        </div>
      </form>
      {result ? result(state) : null}
    </StateContext.Provider>
  );
}

function useField(name: string, hint: ReactNode | undefined) {
  const state = useFormResult();
  const id = useId();
  const error = state.fields?.[name];
  const describedBy =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') ||
    undefined;
  return { state, id, error, describedBy };
}

function FieldText({ id, hint, error }: { id: string; hint?: ReactNode; error?: string }) {
  return (
    <>
      {hint ? (
        <span className="hint" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="field-error" id={`${id}-error`}>
          {error}
        </span>
      ) : null}
    </>
  );
}

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'name'> {
  name: string;
  label: string;
  hint?: ReactNode;
}

export function Field({ name, label, hint, defaultValue, type = 'text', ...rest }: FieldProps) {
  const { state, id, error, describedBy } = useField(name, hint);
  const typed = type === 'password' ? undefined : state.values?.[name];
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <FieldText id={id} hint={hint} error={error} />
      <input
        id={id}
        name={name}
        type={type}
        defaultValue={typed ?? defaultValue}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...rest}
      />
    </div>
  );
}

interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'name'> {
  name: string;
  label: string;
  hint?: ReactNode;
  options: readonly { value: string; label: string }[];
}

export function SelectField({
  name,
  label,
  hint,
  options,
  defaultValue,
  ...rest
}: SelectFieldProps) {
  const { state, id, error, describedBy } = useField(name, hint);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <FieldText id={id} hint={hint} error={error} />
      <select
        // React's form reset returns a select to its first-rendered option, so remount
        // it when the remembered value changes to keep what was chosen.
        key={state.values?.[name] ?? '\u0000'}
        id={id}
        name={name}
        defaultValue={state.values?.[name] ?? defaultValue}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

interface CheckFieldProps {
  name: string;
  label: string;
  hint?: ReactNode;
  defaultChecked?: boolean;
  value?: string;
  disabled?: boolean;
}

export function CheckField({
  name,
  label,
  hint,
  defaultChecked,
  value = 'on',
  disabled,
}: CheckFieldProps) {
  const { state, id, error, describedBy } = useField(name, hint);
  // After an error, a box is ticked again only if it was ticked when submitted.
  const typed = state.values ? state.values[name] === value : undefined;
  return (
    <div className="field field-check">
      <input
        key={typed === undefined ? 'initial' : String(typed)}
        id={id}
        name={name}
        type="checkbox"
        value={value}
        defaultChecked={typed ?? defaultChecked}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      <label htmlFor={id}>{label}</label>
      <FieldText id={id} hint={hint} error={error} />
    </div>
  );
}

interface TextAreaFieldProps {
  name: string;
  label: string;
  hint?: ReactNode;
  defaultValue?: string;
  rows?: number;
  maxLength?: number;
  required?: boolean;
}

/** A multi-line text field, wired to the form state like Field. */
export function TextAreaField({
  name,
  label,
  hint,
  defaultValue,
  rows = 3,
  maxLength,
  required,
}: TextAreaFieldProps) {
  const { state, id, error, describedBy } = useField(name, hint);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <FieldText id={id} hint={hint} error={error} />
      <textarea
        id={id}
        name={name}
        rows={rows}
        maxLength={maxLength}
        required={required}
        defaultValue={state.values?.[name] ?? defaultValue}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
    </div>
  );
}

/** Documents (PDF, JPEG or PNG), checked again by content on the server. */
export function DocumentField({
  name,
  label,
  hint,
  accept = 'application/pdf,image/jpeg,image/png',
  multiple = true,
}: {
  name: string;
  label: string;
  hint?: ReactNode;
  accept?: string;
  multiple?: boolean;
}) {
  const { id, error, describedBy } = useField(name, hint);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <FieldText id={id} hint={hint} error={error} />
      <input
        id={id}
        name={name}
        type="file"
        accept={accept}
        multiple={multiple}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
    </div>
  );
}
