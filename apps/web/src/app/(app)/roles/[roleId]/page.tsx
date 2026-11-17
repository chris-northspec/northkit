import type { Metadata } from 'next';
import Link from 'next/link';
import { ACTIONS, AREAS, can, getRole, siteChoices } from '@northkit/core';
import { ActionForm } from '@/components/form/action-form';
import { db } from '@/lib/server/db';
import { orNotFound, routeId } from '@/lib/server/load';
import { requirePermission } from '@/lib/server/session';
import { archiveRoleAction, updateRoleAction } from '../actions';
import { PermissionMatrix, RoleFields } from '../role-fields';

export const metadata: Metadata = { title: 'Role' };

export default async function RolePage({
  params,
  searchParams,
}: {
  params: Promise<{ roleId: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const session = await requirePermission('users.view');
  const role = await orNotFound(getRole(db(), session.actor, routeId((await params).roleId)));
  const saved = (await searchParams).saved === '1';
  const sites = await siteChoices(db(), session.actor);
  const canEdit =
    can(session.actor, 'users.edit') &&
    session.actor.allSites &&
    !role.fullAccess &&
    !role.archivedAt;

  return (
    <>
      <p className="breadcrumbs">
        <Link href="/roles">Roles and access</Link>
      </p>
      <div className="page-head">
        <h1>{role.name}</h1>
        <span className="muted">
          {role.userCount} {role.userCount === 1 ? 'person' : 'people'}
        </span>
      </div>
      {saved ? (
        <p className="form-message" role="status">
          Role saved. People holding it have the new access from their next page.
        </p>
      ) : null}

      {role.fullAccess ? (
        <>
          <p className="notice notice-info">
            The Administrator always has every switch at every site, must use two-factor sign-in,
            and can’t be changed or archived. At least one active administrator must exist.
          </p>
          <PermissionMatrix
            areas={AREAS}
            actions={ACTIONS}
            permissions={role.permissions}
            readOnly
          />
        </>
      ) : canEdit ? (
        <ActionForm
          action={updateRoleAction.bind(null, role.id, role.rowVersion)}
          submitLabel="Save role"
          className="stack"
        >
          <RoleFields areas={AREAS} actions={ACTIONS} sites={sites} role={role} />
        </ActionForm>
      ) : (
        <div className="stack">
          <RoleFields areas={AREAS} actions={ACTIONS} sites={sites} role={role} readOnly />
        </div>
      )}

      {can(session.actor, 'users.edit') &&
      session.actor.allSites &&
      !role.fullAccess &&
      !role.isSystem ? (
        <section className="panel space-above" aria-labelledby="archive-heading">
          <h2 id="archive-heading">
            {role.archivedAt ? 'Restore this role' : 'Archive this role'}
          </h2>
          <p className="muted">
            {role.archivedAt
              ? 'People who hold it get its access back.'
              : 'People who hold it lose its access straight away. Nothing is deleted.'}
          </p>
          <ActionForm
            action={archiveRoleAction.bind(null, role.id, role.rowVersion, !role.archivedAt)}
            submitLabel={role.archivedAt ? 'Restore role' : 'Archive role'}
            submitClassName={role.archivedAt ? 'button' : 'button button-danger'}
          />
        </section>
      ) : null}
    </>
  );
}
