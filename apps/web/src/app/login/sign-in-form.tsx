'use client';

import { useActionState, useEffect, useRef } from 'react';
import { authAction, type SignInState } from './actions';

export function SignInForm({ initialStep }: { initialStep: SignInState['step'] }) {
  const [state, action, pending] = useActionState(authAction, { step: initialStep });

  const errorRef = useRef<HTMLParagraphElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // An error takes focus; otherwise the code field does when that step appears
    // (autoFocus only acts on the first render of the page).
    if (state.error) errorRef.current?.focus();
    else if (state.step === 'code') codeRef.current?.focus();
  }, [state]);

  const describedBy = state.error ? 'sign-in-error' : undefined;

  return (
    <form action={action} className="stack" noValidate>
      <input type="hidden" name="step" value={state.step} />
      {state.error ? (
        <p className="form-error" role="alert" tabIndex={-1} ref={errorRef} id="sign-in-error">
          {state.error}
        </p>
      ) : null}

      {state.step === 'code' ? (
        <>
          <p>Enter the 6-digit code from your authenticator app.</p>
          <div className="field">
            <label htmlFor="code">Code</label>
            <input
              ref={codeRef}
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              required
              autoFocus
              aria-describedby={describedBy}
            />
          </div>
          <button type="submit" className="button button-primary" disabled={pending}>
            {pending ? 'Checking…' : 'Continue'}
          </button>
        </>
      ) : (
        <>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              defaultValue={state.email}
              required
              autoFocus
              aria-describedby={describedBy}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          <button type="submit" className="button button-primary" disabled={pending}>
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        </>
      )}
    </form>
  );
}
