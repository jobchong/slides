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
});
