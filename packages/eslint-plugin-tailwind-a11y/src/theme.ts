import { resolve } from "node:path";
import type { Rule } from "eslint";
import { resolveTheme, type ResolvedTheme } from "tailwind-a11y";

interface TailwindA11ySettings {
  configPath?: string;
}

// Reads an optional override from ESLint's shared `settings` object rather
// than rule `options`: every rule's `meta.schema` is `[]`, so an `options`
// object would be hard-rejected by ESLint before the rule ever runs, while
// `settings` isn't schema-validated. Falls back to auto-detecting
// tailwind.config.js/.cjs in `context.cwd` when no override is given.
export function resolveThemeForContext(context: Rule.RuleContext): ResolvedTheme {
  const settings = context.settings["tailwind-a11y"] as TailwindA11ySettings | undefined;
  const configPath = settings?.configPath ? resolve(context.cwd, settings.configPath) : null;
  return resolveTheme({ rootDir: context.cwd, configPath });
}
