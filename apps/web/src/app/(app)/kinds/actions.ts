'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  addKindRule,
  createKind,
  deleteKind,
  removeKindRule,
  setKindActive,
  updateKind,
  updateKindRule,
  type KindInput,
  type RuleInput,
} from '@northkit/core';
import type { FormState } from '@/lib/form-state';
import { checked, formAction, text } from '@/lib/server/actions';
import { db } from '@/lib/server/db';
import { requireSession } from '@/lib/server/session';

function kindInput(form: FormData): KindInput {
  return {
    name: text(form, 'name'),
    description: text(form, 'description'),
    assetPrefix: text(form, 'assetPrefix'),
    defaultDaysOut: text(form, 'defaultDaysOut'),
  };
}

function ruleInput(form: FormData): RuleInput {
  return {
    ruleType: text(form, 'ruleType') as RuleInput['ruleType'],
    title: text(form, 'title'),
    intervalValue: text(form, 'intervalValue'),
    intervalUnit: text(form, 'intervalUnit') as RuleInput['intervalUnit'],
    required: checked(form, 'required'),
    note: text(form, 'note'),
  };
}

export async function createKindAction(_s: FormState, form: FormData): Promise<FormState> {
  const session = await requireSession();
  return formAction(form, async () => {
    const kind = await createKind(db(), session.actor, kindInput(form));
    redirect(`/kinds/${kind.id}`);
  });
}

export async function updateKindAction(
  kindId: string,
  rowVersion: number,
  _s: FormState,
  form: FormData,
): Promise<FormState> {
  const session = await requireSession();
  return formAction(form, async () => {
    await updateKind(db(), session.actor, kindId, rowVersion, kindInput(form));
    revalidatePath(`/kinds/${kindId}`);
    return { message: 'Saved.' };
  });
}

export async function setKindActiveAction(
  kindId: string,
  rowVersion: number,
  active: boolean,
  _s: FormState,
  form: FormData,
): Promise<FormState> {
  const session = await requireSession();
  return formAction(form, async () => {
    await setKindActive(db(), session.actor, kindId, rowVersion, active);
    revalidatePath(`/kinds/${kindId}`);
    return { message: active ? 'Kind reactivated.' : 'Kind deactivated. Existing items keep it.' };
  });
}

export async function deleteKindAction(
  kindId: string,
  _s: FormState,
  form: FormData,
): Promise<FormState> {
  const session = await requireSession();
  return formAction(form, async () => {
    await deleteKind(db(), session.actor, kindId);
    redirect('/kinds');
  });
}

export async function addRuleAction(
  kindId: string,
  _s: FormState,
  form: FormData,
): Promise<FormState> {
  const session = await requireSession();
  return formAction(form, async () => {
    await addKindRule(db(), session.actor, kindId, ruleInput(form));
    revalidatePath(`/kinds/${kindId}`);
    return { message: 'Rule added.' };
  });
}

export async function updateRuleAction(
  kindId: string,
  ruleId: string,
  rowVersion: number,
  _s: FormState,
  form: FormData,
): Promise<FormState> {
  const session = await requireSession();
  return formAction(form, async () => {
    await updateKindRule(db(), session.actor, ruleId, rowVersion, ruleInput(form));
    revalidatePath(`/kinds/${kindId}`);
    return { message: 'Rule saved.' };
  });
}

export async function removeRuleAction(
  kindId: string,
  ruleId: string,
  _s: FormState,
  form: FormData,
): Promise<FormState> {
  const session = await requireSession();
  return formAction(form, async () => {
    await removeKindRule(db(), session.actor, ruleId);
    revalidatePath(`/kinds/${kindId}`);
    return { message: 'Rule removed.' };
  });
}
