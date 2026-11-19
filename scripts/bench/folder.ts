// The proof test's one folder in the owner's OpenCode: emptied before each chat, and the only place a test chat may read or edit.
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

/** Empties `folder` apart from its `opencode.json`, then writes `files` into it. A folder without that file is refused untouched. */
export function resetFolder(folder: string, files: Record<string, string>): void {
  if (!existsSync(join(folder, 'opencode.json'))) throw new Error(`Refusing to empty ${folder}: it has no opencode.json, so it is not the test folder`);
  for (const name of readdirSync(folder)) if (name !== 'opencode.json') rmSync(join(folder, name), { recursive: true, force: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(folder, name), text);
}

const ALLOWED = new Set(['read', 'edit', 'write', 'list', 'glob', 'grep']);

/** How the runner answers a test chat's permission question: once, for reading or editing paths inside `folder`; otherwise reject. Never "always", which would save a rule in the owner's OpenCode. */
export function permissionAnswer(request: { action: string; resources: readonly string[] }, folder: string): 'once' | 'reject' {
  const inside = (path: string) => { const rest = relative(folder, resolve(folder, path)); return !rest.startsWith('..') && !isAbsolute(rest); };
  return ALLOWED.has(request.action) && request.resources.length > 0 && request.resources.every(inside) ? 'once' : 'reject';
}
