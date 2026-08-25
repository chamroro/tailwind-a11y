import type { RGB } from "./luminance.js";

// L and C each accept a plain number or a percentage; H accepts a plain
// degree number or an explicit `deg` suffix (`180` and `180deg` render
// identically -- confirmed against a real browser, see below). An alpha
// component (`/ A`) or the `none` keyword for any channel is deliberately
// unsupported and falls through to the "not oklch" case below: the palette
// only ever stores fully opaque colors today (HEX_RE in luminance.ts
// doesn't accept 4/8-digit hex with alpha either), so this mirrors an
// existing limit rather than introducing a new one.
// A real number shape only -- `\d+(?:\.\d+)?|\.\d+` matches "5", "5.5", and
// ".5" but not "5." or "0..5". The looser `[\d.]+` this replaced accepted
// "0..5" too, which Number() coerces to NaN -- silently producing an
// {r:NaN,g:NaN,b:NaN} object where oklchToRgb's contract says this should
// have been rejected outright (caught in review; the isFinite guard below
// is a second, independent layer against the same failure mode).
const NUM = String.raw`\d+(?:\.\d+)?|\.\d+`;
const OKLCH_RE = new RegExp(`^oklch\\(\\s*(${NUM})(%)?\\s+(${NUM})(%)?\\s+(${NUM})(deg)?\\s*\\)$`);

// Standard OKLab <-> linear sRGB conversion matrices (Björn Ottosson's
// published reference, the same ones browsers implement per CSS Color 4).
// Verified this session against a real headless Chrome: rendered each of
// white/black/a midtone gray/saturated red/teal/purple/an intentionally
// out-of-gamut saturated red-orange/percentage-L/percentage-C/a deg-suffixed
// hue onto a <canvas> and read back the actual pixel RGB via getImageData()
// -- getComputedStyle().color isn't usable for this, since modern Chrome
// serializes a computed oklch() value back out as oklch(), not rgb(). Every
// case matched the real browser-rendered pixel exactly (0 channel
// difference), including the out-of-gamut case, confirming both the
// matrices and the clamp-before-gamma-encode approach below are correct as
// implemented, not just approximately close.
function gammaEncode(linear: number): number {
  const clamped = Math.min(1, Math.max(0, linear));
  return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

export function oklchToRgb(value: string): RGB | null {
  const match = OKLCH_RE.exec(value.trim());
  if (!match) return null;

  const [, lRaw, lPct, cRaw, cPct, hRaw] = match;
  const L = lPct ? Number(lRaw) / 100 : Number(lRaw);
  const C = cPct ? (Number(cRaw) / 100) * 0.4 : Number(cRaw); // 100% chroma == 0.4, the CSS Color 4 reference range
  const H = Number(hRaw);

  // Belt-and-suspenders: independent of whether the regex above is airtight,
  // this makes the RGB | null contract impossible to violate -- a NaN here
  // would otherwise propagate silently into a "successfully resolved" but
  // garbage color (rgbToHex would render it as the literal string
  // "#NaNNaNNaN", which downstream code happens to reject today, but only
  // by accident of a stricter hex regex elsewhere, not because this
  // function actually enforced its own contract).
  if (!Number.isFinite(L) || !Number.isFinite(C) || !Number.isFinite(H)) return null;

  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const rLin = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const gLin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bLin = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

  return {
    r: Math.round(gammaEncode(rLin) * 255),
    g: Math.round(gammaEncode(gLin) * 255),
    b: Math.round(gammaEncode(bLin) * 255),
  };
}
