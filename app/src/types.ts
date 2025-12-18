export interface Message {
  role: "user" | "assistant";
  content: string;
}

// Bounds as percentages (0-100)
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Gradient stop for backgrounds
export interface GradientStop {
  position: number;  // 0-100
  color: string;     // hex
}

// Background types
export type SlideBackground =
  | { type: "solid"; color: string }
  | { type: "gradient"; angle: number; stops: GradientStop[] }
  | { type: "image"; url: string }
  | { type: "rasterized"; url: string }  // Complex master template
  | { type: "none" };

// Text styling
export interface TextStyle {
  fontFamily: string;
  fontSize: number;           // px
  fontWeight: "normal" | "bold";
  fontStyle: "normal" | "italic";
  color: string;              // hex
  align: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "bottom";
}

// Editable elements
export interface TextElement {
  content: string;
  style: TextStyle;
}

export interface ImageElement {
  url: string;
  alt?: string;
  objectFit: "contain" | "cover" | "fill";
}

export interface ShapeElement {
  kind: "rect" | "ellipse" | "line" | "roundRect" | "custom";
  fill: string | "none";
  stroke?: string;
  strokeWidth?: number;
  borderRadius?: number;
  svg?: string;               // For custom shapes
}

export interface EditableElement {
  id: string;
  type: "text" | "image" | "shape";
  bounds: Bounds;
  zIndex: number;
  rotation?: number;

  // Type-specific data (one will be set based on type)
  text?: TextElement;
  image?: ImageElement;
  shape?: ShapeElement;
}

// Slide source data for editing
export interface SlideSource {
  background: SlideBackground;
  elements: EditableElement[];

  // Original import metadata
  import?: {
    originalFile?: string;
    slideIndex: number;
    screenshot?: string;      // Base64 or URL for LLM reference
  };
}

export interface Slide {
  id: string;
  html: string;
  source?: SlideSource;       // Structured data for editing
}
