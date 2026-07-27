// Snapshot of tailwindcss/defaultTheme's `spacing` scale, converted to px at
// the standard 16px root (rem values × 16), generated the same way
// defaultPalette.ts was — verified against the real installed `tailwindcss`
// package's `require('tailwindcss/defaultTheme').spacing` rather than
// hand-transcribed. See CLAUDE.md: v1 does not read a user's tailwind.config.
//
// No `/`-fraction keys exist in this base scale (fractions like `w-1/2` are
// merged in separately by Tailwind's width/height theme functions), so a
// fraction class naturally fails this lookup and is skipped as unresolvable
// — the desired behavior, since a fraction is relative, not a fixed px value.
export const spacingScale: Record<string, number> = {
  "0": 0,
  "px": 1,
  "0.5": 2,
  "1": 4,
  "1.5": 6,
  "2": 8,
  "2.5": 10,
  "3": 12,
  "3.5": 14,
  "4": 16,
  "5": 20,
  "6": 24,
  "7": 28,
  "8": 32,
  "9": 36,
  "10": 40,
  "11": 44,
  "12": 48,
  "14": 56,
  "16": 64,
  "20": 80,
  "24": 96,
  "28": 112,
  "32": 128,
  "36": 144,
  "40": 160,
  "44": 176,
  "48": 192,
  "52": 208,
  "56": 224,
  "60": 240,
  "64": 256,
  "72": 288,
  "80": 320,
  "96": 384,
};
