export interface ActionInputs {
  patterns: string[];
  config: string | null;
  failOnViolations: boolean;
  strict: boolean;
}

// The Actions runner exposes inputs as INPUT_<NAME> env vars, uppercased but
// with dashes KEPT as-is -- `fail-on-violations` becomes the env var
// "INPUT_FAIL-ON-VIOLATIONS", which is legal at the OS level (though
// unreachable from POSIX shell syntax) and readable in Node only via bracket
// access. No @actions/core dependency: everything it would provide here is a
// few lines of env/stdout handling, kept as pure functions so they're
// directly unit-testable (same reasoning as cliArgs.ts/format.ts in the
// sibling packages).
export function parseInputs(env: Record<string, string | undefined>): ActionInputs {
  const patternsRaw = env["INPUT_PATTERNS"]?.trim();
  const configRaw = env["INPUT_CONFIG"]?.trim();
  const failRaw = env["INPUT_FAIL-ON-VIOLATIONS"]?.trim().toLowerCase();
  const strictRaw = env["INPUT_STRICT"]?.trim().toLowerCase();

  return {
    patterns: patternsRaw ? patternsRaw.split(/\s+/).filter(Boolean) : ["**/*.{jsx,tsx}"],
    config: configRaw || null,
    // Anything other than an explicit "false" keeps the safe default of
    // failing the job on violations.
    failOnViolations: failRaw !== "false",
    // Opposite direction from failOnViolations above: strict is opt-in, so
    // anything other than an explicit "true" keeps the safe default of the
    // existing WCAG 2.5.8 (AA) 24px threshold.
    strict: strictRaw === "true",
  };
}
