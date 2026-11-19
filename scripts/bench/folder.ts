// The proof test's one folder in the owner's OpenCode: emptied before each chat, and the only place a test chat may read or edit.
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const deny = (action: string) => ({ action, resource: '*', effect: 'deny' });
/** The test folder's own opencode.json: no shell, web, helpers, skills, questions or folders outside it. It is written once, before the owner opens the folder. */
export const TEST_CONFIG = { permissions: ['shell', 'webfetch', 'websearch', 'subagent', 'skill', 'question', 'external_directory', 'experimental_image_generate'].map(deny) };

/**
 * Empties `folder` apart from its `opencode.json`, then writes `files` into it. Only a folder whose opencode.json is exactly the test's own
 * is emptied: a mistyped folder that is a real project, or a test folder whose config a model has edited, is refused untouched.
 */
export function resetFolder(folder: string, files: Record<string, string>): void {
  const config = join(folder, 'opencode.json');
  if (!existsSync(config)) throw new Error(`Refusing to empty ${folder}: it has no opencode.json, so it is not the test folder`);
  let found: unknown;
  try { found = JSON.parse(readFileSync(config, 'utf8')); } catch { found = undefined; }
  if (!isDeepStrictEqual(found, TEST_CONFIG)) throw new Error(`Refusing to empty ${folder}: its opencode.json is not the test's own, so it is not the test folder or it was changed`);
  for (const name of readdirSync(folder)) if (name !== 'opencode.json') rmSync(join(folder, name), { recursive: true, force: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(folder, name), text);
}

const ALLOWED = new Set(['read', 'edit', 'write', 'list', 'glob', 'grep']);

/**
 * How the runner answers a test chat's permission question: once, for reading or editing paths inside `folder` other than its opencode.json;
 * otherwise reject. Never "always", which would save a rule in the owner's OpenCode.
 */
export function permissionAnswer(request: { action: string; resources: readonly string[] }, folder: string): 'once' | 'reject' {
  const inside = (path: string) => { const rest = relative(folder, resolve(folder, path)); return !rest.startsWith('..') && !isAbsolute(rest); };
  const config = (path: string) => basename(path).toLowerCase() === 'opencode.json';
  return ALLOWED.has(request.action) && request.resources.length > 0 && request.resources.every(path => inside(path) && !config(path)) ? 'once' : 'reject';
}

/** Whether OpenCode lists `folder` as a project, compared without regard to case or the kind of slash. The service is asked nothing about a folder before this holds. */
export function isProject(projects: readonly { canonical?: string; directory?: string }[], folder: string): boolean {
  const plain = (path: string) => path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
  return projects.some(project => plain(String(project.canonical ?? project.directory ?? '')) === plain(folder));
}
