'use client';

import { useState } from 'react';
import { CheckField, Field, useFormResult } from '@/components/form/action-form';

export interface MatrixArea {
  key: string;
  label: string;
  covers: string;
}
export interface MatrixAction {
  key: string;
  label: string;
}
export interface RoleValues {
  name: string;
  description: string | null;
  permissions: string[];
  siteScope: 'all' | 'listed';
  siteIds: string[];
  requiresMfa: boolean;
}

/** Ticked state: what was submitted after an error, otherwise the saved value. */
function useTicked() {
  const state = useFormResult();
  return (name: string, saved: boolean) => (state.values ? state.values[name] === 'on' : saved);
}

/**
 * The switches (S1-4): areas down, View/Create/Edit/Approve across, one checkbox per
 * cell, each with its own label. Read-only for people who can't change roles.
 */
export function PermissionMatrix({
  areas,
  actions,
  permissions,
  readOnly = false,
}: {
  areas: readonly MatrixArea[];
  actions: readonly MatrixAction[];
  permissions: readonly string[];
  readOnly?: boolean;
}) {
  const isTicked = useTicked();
  const state = useFormResult();
  const held = new Set(permissions);
  return (
    <div className="table-wrap" role="region" aria-label="Permission switches" tabIndex={0}>
      <table className="table matrix">
        <caption className="visually-hidden">Permissions by area and action</caption>
        <thead>
          <tr>
            <th scope="col">Area</th>
            {actions.map((action) => (
              <th scope="col" key={action.key}>
                {action.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {areas.map((area) => (
            <tr key={area.key}>
              <th scope="row">
                {area.label}
                <span className="hint block">{area.covers}</span>
              </th>
              {actions.map((action) => {
                const code = `${area.key}.${action.key}`;
                const name = `perm:${code}`;
                const on = isTicked(name, held.has(code));
                const id = `perm-${area.key}-${action.key}`;
                return (
                  <td key={action.key}>
                    <label htmlFor={id}>
                      <input
                        // Remount after an error so the box shows what was submitted.
                        key={state.values ? `t${String(on)}` : 'saved'}
                        id={id}
                        type="checkbox"
                        name={name}
                        defaultChecked={on}
                        disabled={readOnly}
                      />
                      <span className="visually-hidden">
                        {area.label}: {action.label}
                      </span>
                    </label>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RoleFields({
  areas,
  actions,
  sites,
  role,
  readOnly = false,
}: {
  areas: readonly MatrixArea[];
  actions: readonly MatrixAction[];
  sites: readonly { id: string; code: string; name: string }[];
  role?: RoleValues;
  readOnly?: boolean;
}) {
  const state = useFormResult();
  const isTicked = useTicked();
  const [scope, setScope] = useState(state.values?.siteScope ?? role?.siteScope ?? 'all');
  const chosen = new Set(role?.siteIds ?? []);
  return (
    <>
      <div className="form-grid">
        <Field
          name="name"
          label="Role name"
          defaultValue={role?.name}
          required
          disabled={readOnly}
        />
        <Field
          name="description"
          label="What it’s for"
          defaultValue={role?.description ?? ''}
          disabled={readOnly}
        />
      </div>
      <h2>Switches</h2>
      <p className="muted">
        Create, Edit or Approve also give View. Approve is for sign-offs, such as verifying a job.
      </p>
      <PermissionMatrix
        areas={areas}
        actions={actions}
        permissions={role?.permissions ?? []}
        readOnly={readOnly}
      />
      <fieldset className="stack">
        <legend>Sites</legend>
        {state.fields?.siteIds ? (
          <span className="field-error" role="alert">
            {state.fields.siteIds}
          </span>
        ) : null}
        {(['all', 'listed'] as const).map((value) => (
          <div className="field field-check" key={value}>
            <input
              id={`siteScope-${value}`}
              type="radio"
              name="siteScope"
              value={value}
              checked={scope === value}
              onChange={() => setScope(value)}
              disabled={readOnly}
            />
            <label htmlFor={`siteScope-${value}`}>
              {value === 'all' ? 'Every site the person is assigned to' : 'Only these sites'}
            </label>
          </div>
        ))}
        {scope === 'listed' ? (
          <ul className="plain">
            {sites.map((s) => (
              <li key={s.id}>
                <CheckField
                  name={`site:${s.id}`}
                  label={`${s.code} · ${s.name}`}
                  defaultChecked={isTicked(`site:${s.id}`, chosen.has(s.id))}
                  disabled={readOnly}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </fieldset>
      <CheckField
        name="requiresMfa"
        label="Holders must use two-factor sign-in"
        hint="They’re asked to set it up before they can do anything else, and can’t turn it off."
        defaultChecked={role?.requiresMfa ?? false}
        disabled={readOnly}
      />
    </>
  );
}
