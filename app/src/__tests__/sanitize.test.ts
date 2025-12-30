import { describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { sanitizeHtml } from "../sanitize";

describe("sanitizeHtml", () => {
  test("removes script tags and inline handlers", () => {
    GlobalRegistrator.register();

    const dirty = `
      <div onclick="alert('x')">Safe</div>
      <script>alert('x')</script>
    `;

    const clean = sanitizeHtml(dirty);

    expect(clean).toContain("Safe");
    expect(clean).not.toContain("script");
    expect(clean).not.toContain("onclick");

    GlobalRegistrator.unregister();
  });

  test("strips javascript URLs in src attributes", () => {
    GlobalRegistrator.register();

    const dirty = `<img src="javascript:alert('x')" />`;
    const clean = sanitizeHtml(dirty);

    expect(clean).toContain("<img");
    expect(clean).not.toContain("javascript:");

    GlobalRegistrator.unregister();
  });

  test("preserves safe svg markup for diagram connectors", () => {
    GlobalRegistrator.register();

    const svg = `
      <svg viewBox="0 0 100 100" style="position:absolute;">
        <line x1="0" y1="50" x2="100" y2="50" stroke="#333" stroke-width="2" />
      </svg>
    `;
    const clean = sanitizeHtml(svg);

    expect(clean).toContain("<svg");
    expect(clean).toContain("<line");

    GlobalRegistrator.unregister();
  });
});
