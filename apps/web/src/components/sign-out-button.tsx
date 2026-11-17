'use client';

import { signOutAction } from '@/app/login/actions';

/** Signing out also tells the service worker to forget the inspection pages it kept. */
export function SignOutButton({ className = 'button' }: { className?: string }) {
  return (
    <form
      action={signOutAction}
      onSubmit={() => navigator.serviceWorker?.controller?.postMessage({ type: 'forget-pages' })}
    >
      <button type="submit" className={className}>
        Sign out
      </button>
    </form>
  );
}
