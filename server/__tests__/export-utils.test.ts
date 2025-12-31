import { describe, expect, test } from "bun:test";
import { boundsToInches, fontSizePxToPt, normalizeColor, WIDE_SLIDE_INCHES } from "../export/utils";

describe("export utils", () => {
  test("boundsToInches maps percentages to slide inches", () => {
    const bounds = { x: 10, y: 20, width: 50, height: 40 };
    const result = boundsToInches(bounds);

    expect(result.x).toBeCloseTo(WIDE_SLIDE_INCHES.width * 0.1, 4);
    expect(result.y).toBeCloseTo(WIDE_SLIDE_INCHES.height * 0.2, 4);
    expect(result.w).toBeCloseTo(WIDE_SLIDE_INCHES.width * 0.5, 4);
    expect(result.h).toBeCloseTo(WIDE_SLIDE_INCHES.height * 0.4, 4);
  });

  test("fontSizePxToPt converts px to points", () => {
    expect(fontSizePxToPt(96)).toBeCloseTo(72, 2);
    expect(fontSizePxToPt(24)).toBeCloseTo(18, 2);
  });

  test("normalizeColor strips hex prefix", () => {
    expect(normalizeColor("#abcdef")).toBe("ABCDEF");
    expect(normalizeColor("FF00AA")).toBe("FF00AA");
    expect(normalizeColor(undefined)).toBeUndefined();
  });
});
