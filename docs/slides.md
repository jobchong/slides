# Slide Deck Behavior

Current reference for multi-slide deck management in the app.

## Data Model

```ts
interface Slide {
  id: string;
  html: string;
  source?: SlideSource;
}

interface DeckState {
  slides: Slide[];
  currentSlideIndex: number;
  messages: Message[];
  model: string;
}
```

Notes:
- `html` is always the rendered slide content.
- `source` is preserved for imported or otherwise structured slides.
- Chat-generated edits replace `html` and typically clear `source`.

## UI Surfaces

- `ThumbnailPanel` shows live scaled HTML previews for every slide.
- `SlideNavigation` shows `current / total` and prev/next buttons.
- `SlideView` renders only the active slide.
- `ChatInput` always edits the active slide.

## Slide Operations

- Add: inserts a blank slide immediately after the current slide and navigates to it.
- Duplicate: clones the current slide, assigns a new `id`, inserts it after the original, and navigates to the copy.
- Delete: removes the selected slide unless it is the last remaining slide.
- Select: clicking a thumbnail or using navigation changes `currentSlideIndex`.
- New Deck: prompts for confirmation, clears local and remote deck identity, and starts a fresh one-slide deck.

## Keyboard Shortcuts

- `ArrowLeft` or `ArrowUp` - previous slide
- `ArrowRight` or `ArrowDown` - next slide
- `Home` - first slide
- `End` - last slide
- `Cmd/Ctrl + M` - add slide after current
- `Delete` or `Backspace` - delete current slide

Shortcut handling is disabled while focus is inside an input, textarea, or contenteditable element.

## Thumbnail Rules

- Thumbnails render the same `html` stored on each slide.
- Empty slides show a placeholder instead of markup.
- The selected thumbnail is focusable and marked with `aria-selected`.
- Delete controls are hidden when the deck only has one slide left.

## Chat Interaction Rules

- Chat always targets `slides[currentSlideIndex]`.
- Streaming model output updates only the current slide.
- Clarification responses do not mutate the slide; they append an assistant question to chat instead.
- Voice input follows the same rule after transcription.

## Import and Export Behavior

- Import appends imported slides to the current deck unless the deck only contains a single empty slide, in which case the first imported slide replaces that placeholder.
- After import, the app navigates to the first imported slide and clears chat history.
- Export includes every slide in deck order.
- Slides with `source` export as editable PPTX content; slides without `source` export as rasterized images.

## Persistence

- Local deck state is saved to `localStorage`.
- Remote deck sync is optional in development and default in production.
- The current slide index is persisted together with the deck.

## Current Non-Goals

- Drag-and-drop reordering
- Undo/redo for slide operations
- Presentation mode
- Multi-user collaboration
