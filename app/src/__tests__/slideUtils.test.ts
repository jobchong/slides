import { describe, expect, test } from "bun:test";
import { cloneSlideWithNewId } from "../slideUtils";
import type { Slide } from "../types";

const sampleSlide: Slide = {
  id: "slide-1",
  html: "<div>Slide</div>",
  source: {
    background: { type: "solid", color: "#ffffff" },
    elements: [
      {
        id: "element-1",
        type: "text",
        bounds: { x: 10, y: 10, width: 80, height: 20 },
        zIndex: 1,
        text: {
          content: "Title",
          style: {
            fontFamily: "Arial",
            fontSize: 24,
            fontWeight: "bold",
            fontStyle: "normal",
            color: "#000000",
            align: "center",
            verticalAlign: "middle",
          },
        },
      },
    ],
  },
};

describe("cloneSlideWithNewId", () => {
  test("creates a deep copy with a new id", () => {
    const cloned = cloneSlideWithNewId(sampleSlide, "slide-2");

    expect(cloned.id).toBe("slide-2");
    expect(cloned.html).toBe(sampleSlide.html);
    expect(cloned.source).toEqual(sampleSlide.source);
    expect(cloned.source).not.toBe(sampleSlide.source);
    expect(cloned.source?.background).not.toBe(sampleSlide.source?.background);
    expect(cloned.source?.elements).not.toBe(sampleSlide.source?.elements);
  });
});
