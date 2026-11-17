// One JSON object per line on stdout, for `docker compose logs`. Never pass secrets.
export function log(
  level: 'info' | 'warn' | 'error',
  message: string,
  fields: Record<string, unknown> = {},
): void {
  process.stdout.write(
    `${JSON.stringify({ time: new Date().toISOString(), level, message, ...fields })}\n`,
  );
}
