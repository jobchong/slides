import DOMPurify from "dompurify";

const DOMPURIFY_CONFIG = {
  USE_PROFILES: { html: true, svg: true },
  ALLOW_DATA_ATTR: true,
  ADD_TAGS: ["svg", "path", "line", "defs", "marker", "polygon", "rect", "circle", "ellipse", "g"],
  ADD_ATTR: [
    "style",
    "viewBox",
    "preserveAspectRatio",
    "markerWidth",
    "markerHeight",
    "refX",
    "refY",
    "orient",
    "marker-end",
    "marker-start",
    "stroke",
    "stroke-width",
    "stroke-dasharray",
    "stroke-linecap",
    "fill",
    "x1",
    "y1",
    "x2",
    "y2",
    "d",
  ],
};

const FORBIDDEN_TAGS = new Set([
  "script",
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
]);

const URL_ATTRS = new Set(["src", "href", "xlink:href"]);

function isUnsafeUrl(value: string): boolean {
  return /^\s*javascript:/i.test(value);
}

function isUnsafeStyle(value: string): boolean {
  return /url\((['\"]?)\s*javascript:/i.test(value);
}

function sanitizeWithDomParser(input: string): string {
  if (typeof DOMParser === "undefined") return input;

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div id="root">${input}</div>`, "text/html");
  const root = doc.getElementById("root");
  if (!root) return input;

  const toRemove: Element[] = [];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);

  while (walker.nextNode()) {
    const el = walker.currentNode as Element;
    if (FORBIDDEN_TAGS.has(el.tagName.toLowerCase())) {
      toRemove.push(el);
      continue;
    }

    const attrs = Array.from(el.attributes);
    for (const attr of attrs) {
      const name = attr.name.toLowerCase();
      const value = attr.value;
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (URL_ATTRS.has(name) && isUnsafeUrl(value)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name === "style" && isUnsafeStyle(value)) {
        el.removeAttribute(attr.name);
      }
    }
  }

  for (const el of toRemove) {
    el.remove();
  }

  return root.innerHTML;
}

export function sanitizeHtml(input: string): string {
  if (typeof window !== "undefined" && typeof DOMPurify?.sanitize === "function") {
    return DOMPurify.sanitize(input, DOMPURIFY_CONFIG);
  }

  return sanitizeWithDomParser(input);
}
