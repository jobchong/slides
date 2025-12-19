// PPTX Import Types

// Unit conversion constants
export const EMU_PER_INCH = 914400;
export const EMU_PER_POINT = 12700;
export const EMU_PER_CM = 360000;

// Slide dimensions
export interface SlideSize {
  width: number;  // EMU
  height: number; // EMU
}

// Bounds as percentages (0-100)
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Element types
export type ElementType =
  | "text"
  | "image"
  | "shape"
  | "line"
  | "table"
  | "chart"
  | "smartart"
  | "group"
  | "unknown";

// Text styling
export interface TextRun {
  text: string;
  fontSize?: number;     // points
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;        // hex color
}

export interface BulletStyle {
  type: "bullet" | "number";
  char?: string;
}

export interface Paragraph {
  runs: TextRun[];
  align?: "left" | "center" | "right" | "justify";
  bullet?: BulletStyle;
  level?: number;        // indentation level (0-8)
  spaceBefore?: number;  // points
  spaceAfter?: number;   // points
}

export interface TextData {
  paragraphs: Paragraph[];
  verticalAlign?: "top" | "middle" | "bottom";
  anchorCtr?: boolean;
  insets?: {
    l?: number;
    r?: number;
    t?: number;
    b?: number;
  };
}

// Image data
export interface ImageData {
  rId: string;           // relationship ID in PPTX
  url?: string;          // after upload to server
}

// Shape data
export interface ShapeData {
  shapeType: string;     // rect, ellipse, line, roundRect, etc.
  fill?: string;         // hex color or "none"
  stroke?: string;       // hex color
  strokeWidth?: number;  // points
  lineCap?: "round" | "square" | "flat";
  lineHead?: "oval" | "none";
  lineTail?: "oval" | "none";
  svgPath?: string;
  svgViewBox?: { width: number; height: number };
}

// Table data
export interface TableCell {
  text: TextData;
  colspan?: number;
  rowspan?: number;
  fill?: string;
}

export interface TableRow {
  cells: TableCell[];
  height?: number;
}

export interface TableData {
  rows: TableRow[];
  columnWidths: number[]; // percentages
}

// Extracted element
export interface ExtractedElement {
  id: string;                  // Unique element ID for editability
  type: ElementType;
  bounds: Bounds;
  zIndex: number;
  rotation?: number;           // degrees

  // Type-specific data (one of these will be set based on type)
  text?: TextData;
  image?: ImageData;
  shape?: ShapeData;
  table?: TableData;
}

// Editable element for frontend (converted from ExtractedElement)
export interface EditableTextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: "normal" | "bold";
  fontStyle: "normal" | "italic";
  color: string;
  align: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "bottom";
}

export interface EditableTextElement {
  content: string;
  style: EditableTextStyle;
  anchorCtr?: boolean;
  insets?: {
    l?: number;
    r?: number;
    t?: number;
    b?: number;
  };
}

export interface EditableImageElement {
  url: string;
  alt?: string;
  objectFit: "contain" | "cover" | "fill";
}

export interface EditableShapeElement {
  kind: "rect" | "ellipse" | "line" | "roundRect" | "custom";
  fill: string | "none";
  stroke?: string;
  strokeWidth?: number;
  borderRadius?: number;
  svg?: string;
  lineCap?: "round" | "square" | "flat";
  lineHead?: "oval" | "none";
  lineTail?: "oval" | "none";
  svgPath?: string;
  svgViewBox?: { width: number; height: number };
}

export interface EditableElement {
  id: string;
  type: "text" | "image" | "shape";
  bounds: Bounds;
  zIndex: number;
  rotation?: number;
  text?: EditableTextElement;
  image?: EditableImageElement;
  shape?: EditableShapeElement;
}

// Slide background types for frontend
export type SlideBackground =
  | { type: "solid"; color: string }
  | { type: "gradient"; angle: number; stops: GradientStop[] }
  | { type: "image"; url: string }
  | { type: "rasterized"; url: string }
  | { type: "none" };

// SlideSource for frontend editing
export interface SlideSource {
  background: SlideBackground;
  elements: EditableElement[];
  import?: {
    originalFile?: string;
    slideIndex: number;
    screenshot?: string;
  };
}

// Prepared slide ready for LLM conversion
export interface PreparedSlide {
  background: SlideBackground;
  elements: EditableElement[];
  screenshot?: string;
  theme: Theme;
}

// Background
export interface GradientStop {
  position: number;      // 0-100
  color: string;
}

export interface Background {
  type: "solid" | "gradient" | "image" | "none";
  color?: string;
  rId?: string;
  imageUrl?: string;
  gradient?: {
    angle: number;
    stops: GradientStop[];
  };
}

// Extracted slide
export interface ExtractedSlide {
  index: number;
  elements: ExtractedElement[];
  background: Background;
}

// Theme colors
export interface ThemeColors {
  dk1: string;      // Dark 1
  lt1: string;      // Light 1
  dk2: string;      // Dark 2
  lt2: string;      // Light 2
  accent1: string;
  accent2: string;
  accent3: string;
  accent4: string;
  accent5: string;
  accent6: string;
  hlink: string;
  folHlink: string;
  [key: string]: string; // Allow string indexing
}

// Theme fonts
export interface ThemeFonts {
  majorLatin: string;
  minorLatin: string;
}

// Full theme
export interface Theme {
  colors: ThemeColors;
  fonts: ThemeFonts;
}

// Slide relationships (maps rId to target path)
export type SlideRelationships = Map<string, string>;

// Import options
export interface ImportOptions {
  concurrency?: number;
}

// Import progress
export interface ImportProgress {
  type: "progress" | "slide" | "error" | "done";
  current?: number;
  total?: number;
  status?: string;
  index?: number;
  html?: string;
  source?: SlideSource;        // Structured data for editing
  error?: string;
}

// Import result
// PPTX structure
export interface PptxContent {
  slideSize: SlideSize;
  slideOrder: string[];  // rIds in order
  theme: Theme;
  mediaFiles: Map<string, Buffer>;
}
