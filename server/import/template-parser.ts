import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, unlink, rmdir } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { randomUUID } from "node:crypto";

import type { Background, ExtractedElement, SlideRelationships, SlideSize, Theme } from "./types";
import { parsePresentation, parseRelationships, parseSlide } from "./parser";
import { getDefaultTheme, parseTheme } from "./theme";

export type TemplateSlide = {
  path: string;
  name?: string;
  background: Background;
  elements: ExtractedElement[];
  relationships: SlideRelationships;
};

export type TemplateLayout = TemplateSlide & {
  masterPath?: string;
};

export type TemplateRegistry = {
  slideSize: SlideSize;
  masters: TemplateSlide[];
  layouts: TemplateLayout[];
};

type RelationshipInfo = {
  id: string;
  type?: string;
  target: string;
};

async function runCommand(command: string, args: string[], errorPrefix: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(command, args);
    let stderr = "";
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${errorPrefix}: ${stderr}`));
        return;
      }
      resolve();
    });
    proc.on("error", (err) => {
      reject(new Error(`${errorPrefix}: ${err.message}`));
    });
  });
}

async function unzipPptx(pptxPath: string, outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await runCommand("unzip", ["-o", "-q", pptxPath, "-d", outputDir], "Failed to unzip PPTX");
}

async function readPptxFile(pptxDir: string, relativePath: string): Promise<string | null> {
  const normalized = normalize(relativePath).replace(/\\/g, "/");
  if (
    normalized.startsWith("/") ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.includes("\0") ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    return null;
  }
  try {
    return await readFile(join(pptxDir, normalized), "utf-8");
  } catch {
    return null;
  }
}

async function cleanupDir(dir: string): Promise<void> {
  try {
    const files = await readdir(dir, { withFileTypes: true });
    for (const file of files) {
      const path = join(dir, file.name);
      if (file.isDirectory()) {
        await cleanupDir(path);
      } else {
        await unlink(path);
      }
    }
    await rmdir(dir);
  } catch {
    // Best-effort cleanup only.
  }
}

function parseMasterIds(xml: string): string[] {
  const ids: string[] = [];
  const masterIdRegex = /<p:sldMasterId[^>]*r:id="([^"]+)"/g;
  let match;
  while ((match = masterIdRegex.exec(xml)) !== null) {
    ids.push(match[1]);
  }
  return ids;
}

function parseLayoutIds(xml: string): string[] {
  const ids: string[] = [];
  const layoutIdRegex = /<p:sldLayoutId[^>]*r:id="([^"]+)"/g;
  let match;
  while ((match = layoutIdRegex.exec(xml)) !== null) {
    ids.push(match[1]);
  }
  return ids;
}

function parseSlideName(xml: string): string | undefined {
  const sldLayoutName = xml.match(/<p:sldLayout[^>]*name="([^"]+)"/);
  if (sldLayoutName) return sldLayoutName[1];
  const cSldName = xml.match(/<p:cSld[^>]*name="([^"]+)"/);
  if (cSldName) return cSldName[1];
  return undefined;
}

export function resolveRelationshipTargetPath(basePath: string, target: string): string {
  if (target.startsWith("/")) {
    return normalize(target.slice(1));
  }
  const baseDir = dirname(basePath);
  return normalize(join(baseDir, target));
}

function parseRelationshipsWithType(xml: string): RelationshipInfo[] {
  const relRegex = /<Relationship\b[^>]*>/g;
  const rels: RelationshipInfo[] = [];
  let match;
  while ((match = relRegex.exec(xml)) !== null) {
    const attrs = match[0];
    const attrRegex = /(\w+)\s*=\s*"([^"]*)"/g;
    let attrMatch;
    const data: Record<string, string> = {};
    while ((attrMatch = attrRegex.exec(attrs)) !== null) {
      data[attrMatch[1]] = attrMatch[2];
    }
    if (data.Id && data.Target) {
      rels.push({ id: data.Id, target: data.Target, type: data.Type });
    }
  }
  return rels;
}

export function findRelationshipTargetByType(
  xml: string,
  typeSuffix: string
): string | undefined {
  const rels = parseRelationshipsWithType(xml);
  const match = rels.find((rel) => rel.type?.endsWith(typeSuffix));
  return match?.target;
}

export async function extractTemplatesFromDir(
  pptxDir: string,
  presentationXml: string,
  slideSize: SlideSize,
  theme: Theme
): Promise<TemplateRegistry> {
  const presentationPath = "ppt/presentation.xml";
  const presRelsXml = await readPptxFile(pptxDir, "ppt/_rels/presentation.xml.rels");
  const presRels = presRelsXml ? parseRelationships(presRelsXml) : new Map<string, string>();

  const masters: TemplateSlide[] = [];
  const layouts: TemplateLayout[] = [];
  const masterIds = parseMasterIds(presentationXml);

  for (const masterRId of masterIds) {
    const masterTarget = presRels.get(masterRId);
    if (!masterTarget) continue;

    const masterPath = resolveRelationshipTargetPath(presentationPath, masterTarget);
    const masterXml = await readPptxFile(pptxDir, masterPath);
    if (!masterXml) continue;

    const masterRelsPath = masterPath.replace(/\/([^/]+)\.xml$/, "/_rels/$1.xml.rels");
    const masterRelsXml = await readPptxFile(pptxDir, masterRelsPath);
    const masterRels = masterRelsXml ? parseRelationships(masterRelsXml) : new Map<string, string>();

    const extractedMaster = parseSlide(masterXml, -1, slideSize, theme, masterRels, {
      includeEmptyPlaceholders: true,
    });

    masters.push({
      path: masterPath,
      name: parseSlideName(masterXml),
      background: extractedMaster.background,
      elements: extractedMaster.elements,
      relationships: masterRels,
    });

    const layoutIds = parseLayoutIds(masterXml);
    for (const layoutRId of layoutIds) {
      const layoutTarget = masterRels.get(layoutRId);
      if (!layoutTarget) continue;
      const layoutPath = resolveRelationshipTargetPath(masterPath, layoutTarget);
      const layoutXml = await readPptxFile(pptxDir, layoutPath);
      if (!layoutXml) continue;

      const layoutRelsPath = layoutPath.replace(/\/([^/]+)\.xml$/, "/_rels/$1.xml.rels");
      const layoutRelsXml = await readPptxFile(pptxDir, layoutRelsPath);
      const layoutRels = layoutRelsXml ? parseRelationships(layoutRelsXml) : new Map<string, string>();

      const masterTargetFromLayout = layoutRelsXml
        ? findRelationshipTargetByType(layoutRelsXml, "slideMaster")
        : undefined;
      const masterPathFromLayout = masterTargetFromLayout
        ? resolveRelationshipTargetPath(layoutPath, masterTargetFromLayout)
        : undefined;

      const extractedLayout = parseSlide(layoutXml, -2, slideSize, theme, layoutRels, {
        includeEmptyPlaceholders: true,
      });

      layouts.push({
        path: layoutPath,
        masterPath: masterPathFromLayout,
        name: parseSlideName(layoutXml),
        background: extractedLayout.background,
        elements: extractedLayout.elements,
        relationships: layoutRels,
      });
    }
  }

  return { slideSize, masters, layouts };
}

export async function extractTemplatesFromPptx(
  pptxPath: string
): Promise<TemplateRegistry> {
  const cwd = process.cwd();
  const workDir = join(cwd, ".tmp", `.work-${randomUUID()}`);
  await unzipPptx(pptxPath, workDir);

  try {
    const presentationXml = await readPptxFile(workDir, "ppt/presentation.xml");
    if (!presentationXml) {
      throw new Error("Invalid PPTX: missing ppt/presentation.xml");
    }

    const { slideSize } = parsePresentation(presentationXml);
    const themeXml = await readPptxFile(workDir, "ppt/theme/theme1.xml");
    const theme = themeXml ? parseTheme(themeXml) : getDefaultTheme();

    return await extractTemplatesFromDir(workDir, presentationXml, slideSize, theme);
  } finally {
    await cleanupDir(workDir);
  }
}
