import { can, getItemImport, importProblemsCsv, NotFoundError } from '@northkit/core';
import { db } from '@/lib/server/db';
import { isUuid } from '@/lib/server/load';
import { currentSession } from '@/lib/server/session';

/** The check report as a CSV, to fix the file against (formula-safe). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ importId: string }> },
): Promise<Response> {
  const { importId } = await params;
  const session = await currentSession();
  if (!session || !can(session.actor, 'imports.view') || !isUuid(importId))
    return new Response('Not found', { status: 404 });
  try {
    const imp = await getItemImport(db(), session.actor, importId);
    return new Response(importProblemsCsv(imp.parsed), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="northkit-import-problems.csv"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) return new Response('Not found', { status: 404 });
    throw error;
  }
}
