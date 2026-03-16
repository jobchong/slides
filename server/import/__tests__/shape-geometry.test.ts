import { describe, expect, test } from "bun:test";

import { convertBackground, convertToEditable } from "../converter";
import { parseSlide, resetElementIdCounter } from "../parser";
import { renderSlideHtml } from "../render";
import { buildPresetShapeGeometry, parsePresetAdjustments } from "../shape-geometry";
import { getDefaultTheme } from "../theme";
import type { SlideSize } from "../types";

describe("preset shape geometry", () => {
  test("builds basic polygon presets as SVG paths", () => {
    const cases = [
      {
        shapeType: "diamond",
        size: { width: 200, height: 100 },
        expectedPath: "M 100 0 L 200 50 L 100 100 L 0 50 Z",
      },
      {
        shapeType: "triangle",
        size: { width: 200, height: 100 },
        expectedPath: "M 100 0 L 200 100 L 0 100 Z",
      },
      {
        shapeType: "rtTriangle",
        size: { width: 200, height: 100 },
        expectedPath: "M 0 0 L 200 100 L 0 100 Z",
      },
    ] as const;

    for (const { shapeType, size, expectedPath } of cases) {
      const geometry = buildPresetShapeGeometry(shapeType, size, {});
      expect(geometry).not.toBeNull();
      expect(geometry?.svgPath).toBe(expectedPath);
      expect(geometry?.svgViewBox).toEqual(size);
    }
  });

  test("uses preset adjustments for trapezoids", () => {
    const adjustments = parsePresetAdjustments(`
      <a:prstGeom prst="trapezoid">
        <a:avLst>
          <a:gd name="adj" fmla="val 10000"/>
        </a:avLst>
      </a:prstGeom>
    `);

    const geometry = buildPresetShapeGeometry("trapezoid", { width: 200, height: 100 }, adjustments);

    expect(geometry?.svgPath).toBe("M 20 0 L 180 0 L 200 100 L 0 100 Z");
  });

  test("mirrors asymmetrical presets when flips are present", () => {
    const geometry = buildPresetShapeGeometry(
      "parallelogram",
      { width: 200, height: 100 },
      {},
      { flipH: true }
    );

    expect(geometry?.svgPath).toBe("M 150 0 L 0 0 L 50 100 L 200 100 Z");
  });

  test("builds pentagons with stable regular-polygon ratios", () => {
    const geometry = buildPresetShapeGeometry("pentagon", { width: 100, height: 100 }, {});

    expect(geometry?.svgPath).toBe("M 50 0 L 100 38.2 L 80.9 100 L 19.1 100 L 0 38.2 Z");
  });
});

describe("preset shape parser integration", () => {
  test("renders custom SVG for flipped preset polygons", () => {
    resetElementIdCounter();

    const theme = getDefaultTheme();
    const slideSize: SlideSize = { width: 1000, height: 1000 };
    const slideXml = `
      <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:cSld>
          <p:spTree>
            <p:nvGrpSpPr>
              <p:cNvPr id="0" name=""/>
              <p:cNvGrpSpPr/>
              <p:nvPr/>
            </p:nvGrpSpPr>
            <p:grpSpPr/>
            <p:sp>
              <p:nvSpPr>
                <p:cNvPr id="1" name="Parallelogram 1"/>
                <p:cNvSpPr/>
                <p:nvPr/>
              </p:nvSpPr>
              <p:spPr>
                <a:xfrm flipH="1">
                  <a:off x="100" y="200"/>
                  <a:ext cx="200" cy="100"/>
                </a:xfrm>
                <a:prstGeom prst="parallelogram">
                  <a:avLst/>
                </a:prstGeom>
                <a:solidFill>
                  <a:srgbClr val="FF0000"/>
                </a:solidFill>
              </p:spPr>
            </p:sp>
          </p:spTree>
        </p:cSld>
      </p:sld>
    `;

    const extractedSlide = parseSlide(slideXml, 0, slideSize, theme, new Map());
    expect(extractedSlide.elements).toHaveLength(1);
    expect(extractedSlide.elements[0].shape?.svgPath).toBe("M 150 0 L 0 0 L 50 100 L 200 100 Z");

    const editable = convertToEditable(extractedSlide.elements[0], theme);
    expect(editable?.shape?.kind).toBe("custom");

    const html = renderSlideHtml({
      background: convertBackground(extractedSlide.background),
      elements: editable ? [editable] : [],
      import: { slideIndex: 0 },
    });

    expect(html).toContain('<path d="M 150 0 L 0 0 L 50 100 L 200 100 Z"');
  });
});
