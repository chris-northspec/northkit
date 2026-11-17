'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';

// The main menu (B-1, house style S7-11). From 1024 px it is the Ink sidebar on the left,
// always shown. Below that the Menu button in the top bar opens it as a panel from the
// left; Escape, the Close button or following a link closes it. Without JavaScript the
// menu simply follows the page content, where the "Skip to menu" link reaches it.

type Listener = () => void;
let open = false;
let focusOnOpen = false;
const listeners = new Set<Listener>();
function setOpen(value: boolean, focus = false) {
  open = value;
  focusOnOpen = value && focus;
  listeners.forEach((l) => l());
}
function subscribe(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}
const useOpen = () =>
  useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  );
const useMounted = () =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

const BUTTON_ID = 'menu-button';

/** The Menu button in the top bar below 1024 px. Rendered only once JavaScript runs. */
export function MenuButton() {
  const isOpen = useOpen();
  const mounted = useMounted();
  if (!mounted) return null;
  return (
    <button
      id={BUTTON_ID}
      type="button"
      className="button menu-button"
      aria-expanded={isOpen}
      aria-controls="main-nav"
      onClick={() => setOpen(!isOpen, true)}
    >
      Menu
    </button>
  );
}

/** "Skip to menu": on a phone it opens the panel first, so there is something to reach. */
export function SkipToMenu() {
  return (
    <a
      className="skip-link"
      href="#main-nav"
      onClick={(e) => {
        e.preventDefault();
        setOpen(true, true);
        // Wide screens: the menu is already shown, so focus it now.
        document.getElementById('main-nav')?.focus();
      }}
    >
      Skip to menu
    </a>
  );
}

/** The menu itself: a `<nav aria-label="Main">` landmark, first after the skip links. */
export function MenuPanel({ children }: { children: ReactNode }) {
  const isOpen = useOpen();
  const mounted = useMounted();
  const path = usePathname();
  const nav = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!isOpen) return;
    if (focusOnOpen) (close.current?.offsetParent ? close.current : nav.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      document.getElementById(BUTTON_ID)?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen]);

  return (
    <nav
      ref={nav}
      id="main-nav"
      aria-label="Main"
      className="sidebar"
      tabIndex={-1}
      data-menu={mounted ? (isOpen ? 'open' : 'closed') : undefined}
    >
      {mounted ? (
        <button
          ref={close}
          type="button"
          className="button menu-close"
          onClick={() => {
            setOpen(false);
            document.getElementById(BUTTON_ID)?.focus();
          }}
        >
          Close menu
        </button>
      ) : null}
      {children}
    </nav>
  );
}
