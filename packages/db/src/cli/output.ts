// CLI scripts report through these rather than console.*, which lint forbids elsewhere.
export function say(line = ''): void {
  process.stdout.write(`${line}\n`);
}

export function fail(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
