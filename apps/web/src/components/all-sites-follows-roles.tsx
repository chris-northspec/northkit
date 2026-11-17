'use client';

import { useEffect } from 'react';

/**
 * On the add-user form: ticking an estate-wide role (Administrator, Head of Facilities)
 * ticks "Every site" too, until the person adding them sets that box themselves (B-2).
 * Without JavaScript nothing is ticked for them; the hint says what to do.
 */
export function AllSitesFollowsRoles({ roleCodes }: { roleCodes: readonly string[] }) {
  useEffect(() => {
    const box = document.querySelector<HTMLInputElement>('input[name="allSites"]');
    if (!box) return;
    const roles = roleCodes
      .map((code) => document.querySelector<HTMLInputElement>(`input[name="role:${code}"]`))
      .filter((input): input is HTMLInputElement => input !== null);
    let touched = false;
    const onBox = () => {
      touched = true;
    };
    const onRole = () => {
      if (!touched) box.checked = roles.some((r) => r.checked);
    };
    box.addEventListener('change', onBox);
    roles.forEach((r) => r.addEventListener('change', onRole));
    return () => {
      box.removeEventListener('change', onBox);
      roles.forEach((r) => r.removeEventListener('change', onRole));
    };
  }, [roleCodes]);
  return null;
}
