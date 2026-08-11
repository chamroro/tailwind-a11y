// Split out from cli.ts so it's importable in tests without triggering
// cli.ts's top-level main() call (which does real file I/O on import).

export interface ParsedArgs {
  help: boolean;
  version: boolean;
  verbose: boolean;
  config: string | null;
  configError: string | null;
  patterns: string[];
}

const HELP_TEXT = `Usage: tailwind-a11y [options] [<glob>...]

Static analysis for Tailwind CSS accessibility violations -- color contrast,
touch target size, and focus indicator removal.

Options:
  -v, --verbose      Also report what couldn't be checked, and why
  -V, --version      Print the version number
  -h, --help         Print this help message
      --config <path>  Path to a tailwind.config.js/.cjs (v3) or a CSS
                        @theme file like app/globals.css (v4) to read
                        custom theme colors/spacing from (default:
                        auto-detected in the current directory)

Examples:
  tailwind-a11y                    Scan **/*.{jsx,tsx} from the current directory
  tailwind-a11y "src/**/*.tsx"     Scan a custom glob pattern
  tailwind-a11y --verbose          Also report skipped/unresolvable cases
  tailwind-a11y --config ./tailwind.config.cjs
`;

export function getHelpText(): string {
  return HELP_TEXT;
}

// -v/--verbose already existed before --version was added; -V (uppercase)
// avoids colliding with it, matching a common CLI convention.
const FLAGS = new Set(["--verbose", "-v", "--version", "-V", "--help", "-h"]);

export function parseArgs(argv: string[]): ParsedArgs {
  let config: string | null = null;
  let configError: string | null = null;
  const patterns: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg !== "--config") {
      if (!FLAGS.has(arg)) patterns.push(arg);
      continue;
    }

    const value = argv[i + 1];
    // A missing value or one that looks like another flag (starts with "-")
    // must not be silently swallowed as a bogus path -- report a usage error
    // instead of guessing.
    if (value === undefined || value.startsWith("-")) {
      configError = "--config requires a path argument";
    } else {
      config = value;
      i++; // consume the value too, so it isn't also treated as a glob pattern
    }
  }

  return {
    help: argv.includes("--help") || argv.includes("-h"),
    version: argv.includes("--version") || argv.includes("-V"),
    verbose: argv.includes("--verbose") || argv.includes("-v"),
    config,
    configError,
    patterns,
  };
}
