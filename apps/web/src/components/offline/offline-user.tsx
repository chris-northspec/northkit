'use client';

import { createContext, useContext, type ReactNode } from 'react';

// Who is signed in, for the screens that can save a change to this phone's queue with no
// signal (S3-6). The queue is per person, so a shared phone never sends one person's work
// as someone else's.

const OfflineUserContext = createContext<{ id: string; name: string } | null>(null);

export function OfflineUser({
  user,
  children,
}: {
  user: { id: string; name: string } | null;
  children: ReactNode;
}) {
  return <OfflineUserContext.Provider value={user}>{children}</OfflineUserContext.Provider>;
}

export function useOfflineUser(): { id: string; name: string } | null {
  return useContext(OfflineUserContext);
}
