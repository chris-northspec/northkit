import { can, itemImportTemplateCsv, itemImportTemplateXlsx } from '@northkit/core';
import { db } from '@/lib/server/db';
import { currentSession } from '@/lib/server/session';

/** The import template, as Excel (with a sheet listing the kinds and depots to use) or CSV. */
export async function GET(request: Request): Promise<Response> {
  const session = await currentSession();
  if (!session || !can(session.actor, 'imports.view'))
    return new Response('Not found', { status: 404 });
  const xlsx = new URL(request.url).searchParams.get('format') === 'xlsx';
  if (xlsx) {
    const file = await itemImportTemplateXlsx(db(), session.actor);
    return new Response(new Uint8Array(file), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="northkit-items-template.xlsx"',
        'Cache-Control': 'no-store',
      },
    });
  }
  return new Response(`Feff${itemImportTemplateCsv()}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="northkit-items-template.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
