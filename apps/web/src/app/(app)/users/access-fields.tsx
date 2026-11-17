import { AllSitesFollowsRoles } from '@/components/all-sites-follows-roles';
import { CheckField } from '@/components/form/action-form';

/** Roles and sites for a user: who they are allowed to be, and where. */
export function AccessFields({
  roles,
  sites,
  held,
  siteIds,
  allSites,
  canGrantAllSites,
  allSitesRoleCodes,
}: {
  roles: { code: string; name: string; description: string | null }[];
  sites: { id: string; code: string; name: string }[];
  held: string[];
  siteIds: string[];
  allSites: boolean;
  canGrantAllSites: boolean;
  /** New users only: these roles tick "Every site" for them (B-2). */
  allSitesRoleCodes?: readonly string[];
}) {
  return (
    <>
      <fieldset className="stack">
        <legend>Roles</legend>
        {roles.map((r) => (
          <CheckField
            key={r.code}
            name={`role:${r.code}`}
            label={r.name}
            hint={r.description ?? undefined}
            defaultChecked={held.includes(r.code)}
          />
        ))}
      </fieldset>
      <fieldset className="stack">
        <legend>Sites</legend>
        {canGrantAllSites ? (
          <CheckField
            name="allSites"
            label="Every site, including new ones"
            hint={
              allSitesRoleCodes
                ? 'For estate-wide staff. Ticked for you when you choose Administrator or Head of Facilities; untick it to limit them to the sites below.'
                : 'For estate-wide staff such as a Head of Facilities.'
            }
            defaultChecked={allSites}
          />
        ) : null}
        {canGrantAllSites && allSitesRoleCodes ? (
          <AllSitesFollowsRoles roleCodes={allSitesRoleCodes} />
        ) : null}
        <p className="muted small">Or the sites they work at:</p>
        {sites.map((s) => (
          <CheckField
            key={s.id}
            name={`site:${s.id}`}
            label={`${s.code} · ${s.name}`}
            defaultChecked={siteIds.includes(s.id)}
          />
        ))}
      </fieldset>
    </>
  );
}
