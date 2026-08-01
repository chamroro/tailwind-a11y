export interface RGB {
  r: number;
  g: number;
  b: number;
}

const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function hexToRgb(hex: string): RGB | null {
  const match = HEX_RE.exec(hex);
  if (!match) return null;

  let digits = match[1];
  if (digits.length === 3) {
    digits = digits
      .split("")
      .map((c) => c + c)
      .join("");
  }

  return {
    r: parseInt(digits.slice(0, 2), 16),
    g: parseInt(digits.slice(2, 4), 16),
    b: parseInt(digits.slice(4, 6), 16),
  };
}

// Standard "src-over" compositing of a foreground at `alpha` opacity over an
// opaque background, in gamma-encoded sRGB space (0-255 channels) -- matches
// how browsers actually composite CSS opacity, no linear-light conversion
// needed for a simple two-layer blend.
export function applyAlpha(fg: RGB, alpha: number, bg: RGB): RGB {
  return {
    r: Math.round(alpha * fg.r + (1 - alpha) * bg.r),
    g: Math.round(alpha * fg.g + (1 - alpha) * bg.g),
    b: Math.round(alpha * fg.b + (1 - alpha) * bg.b),
  };
}

function channelLuminance(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(rgb: RGB): number {
  return (
    0.2126 * channelLuminance(rgb.r) +
    0.7152 * channelLuminance(rgb.g) +
    0.0722 * channelLuminance(rgb.b)
  );
}

export function contrastRatio(rgb1: RGB, rgb2: RGB): number {
  const l1 = relativeLuminance(rgb1);
  const l2 = relativeLuminance(rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function requiredRatio(level: "AA" | "AAA", isLargeText: boolean): number {
  if (level === "AAA") return isLargeText ? 4.5 : 7.0;
  return isLargeText ? 3.0 : 4.5;
}

export function meetsWCAG(ratio: number, level: "AA" | "AAA", isLargeText: boolean): boolean {
  return ratio >= requiredRatio(level, isLargeText);
}
