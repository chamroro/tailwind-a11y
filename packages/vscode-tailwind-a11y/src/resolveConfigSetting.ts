import { isAbsolute, resolve } from "node:path";

// Mirrors eslint-plugin-tailwind-a11y/src/theme.ts's resolveThemeForContext:
// resolve the raw setting against rootDir if both are present. Kept in its
// own module (no 'vscode' import) so it's testable under vitest, which can't
// load the 'vscode' module outside the extension host -- same reason
// format.ts is split out.
//
// path.resolve(rootDir, raw) already returns an already-absolute raw
// unchanged regardless of rootDir, so an absolute setting value still works
// even with no workspace folder open (single-file mode). A *relative* value
// with no rootDir to resolve it against can't be turned into anything
// meaningful, so it's dropped -- same "don't guess" precedent as the rest of
// this engine's config resolution.
export function resolveConfigPathSetting(raw: string | undefined, rootDir: string | null): string | null {
  if (!raw) return null;
  if (!rootDir) return isAbsolute(raw) ? raw : null;
  return resolve(rootDir, raw);
}
