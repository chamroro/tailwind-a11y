// Split out from cli.ts so it's importable in tests without triggering
// cli.ts's top-level main() call (which does real file I/O on import).

export interface ParsedArgs {
  help: boolean;
  version: boolean;
  verbose: boolean;
  patterns: string[];
}

const HELP_TEXT = `Usage: tailwind-a11y [options] [<glob>...]

Static analysis for Tailwind CSS accessibility violations -- color contrast,
touch target size, and focus indicator removal.

Options:
  -v, --verbose   Also report what couldn't be checked, and why
  -V, --version   Print the version number
  -h, --help      Print this help message

Examples:
  tailwind-a11y                    Scan **/*.{jsx,tsx} from the current directory
  tailwind-a11y "src/**/*.tsx"     Scan a custom glob pattern
  tailwind-a11y --verbose          Also report skipped/unresolvable cases
`;

export function getHelpText(): string {
  return HELP_TEXT;
}

// -v/--verbose already existed before --version was added; -V (uppercase)
// avoids colliding with it, matching a common CLI convention.
const FLAGS = new Set(["--verbose", "-v", "--version", "-V", "--help", "-h"]);

export function parseArgs(argv: string[]): ParsedArgs {
  return {
    help: argv.includes("--help") || argv.includes("-h"),
    version: argv.includes("--version") || argv.includes("-V"),
    verbose: argv.includes("--verbose") || argv.includes("-v"),
    patterns: argv.filter((a) => !FLAGS.has(a)),
  };
}
