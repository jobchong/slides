import { describe, expect, test } from "bun:test";

import { parseModelOutput } from "../llm";

describe("parseModelOutput", () => {
  test("parses diagram JSON wrapped in code fences", () => {
    const output = `
      <diagram>
      \`\`\`json
      {
        "layout": { "type": "flowchart", "direction": "horizontal" },
        "nodes": [{ "id": "a", "label": "Start" }],
        "connectors": []
      }
      \`\`\`
      </diagram>
    `;

    const parsed = parseModelOutput(output);
    expect(parsed.type).toBe("diagram");
    if (parsed.type === "diagram") {
      expect(parsed.intent.layout.type).toBe("flowchart");
      expect(parsed.intent.nodes.length).toBe(1);
    }
  });
});
