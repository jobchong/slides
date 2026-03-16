const DIAGRAM_TAG_PREFIX = "<diagram";

function overlapSuffixPrefix(value: string, token: string): number {
  const max = Math.min(value.length, token.length - 1);
  for (let i = max; i >= 1; i--) {
    if (token.startsWith(value.slice(-i))) {
      return i;
    }
  }
  return 0;
}

export interface DiagramStreamFinalizeResult {
  accumulated: string;
  remainder: string;
  diagramDetected: boolean;
}

export function createDiagramStreamGate() {
  let accumulated = "";
  let flushedLength = 0;
  let diagramDetected = false;

  return {
    append(chunk: string): string {
      accumulated += chunk;
      if (diagramDetected || accumulated.includes(DIAGRAM_TAG_PREFIX)) {
        diagramDetected = true;
        return "";
      }

      const safeLength = accumulated.length - overlapSuffixPrefix(accumulated, DIAGRAM_TAG_PREFIX);
      if (safeLength <= flushedLength) {
        return "";
      }

      const nextChunk = accumulated.slice(flushedLength, safeLength);
      flushedLength = safeLength;
      return nextChunk;
    },

    finalize(): DiagramStreamFinalizeResult {
      const remainder =
        !diagramDetected && flushedLength < accumulated.length
          ? accumulated.slice(flushedLength)
          : "";
      flushedLength = accumulated.length;
      return { accumulated, remainder, diagramDetected };
    },
  };
}
