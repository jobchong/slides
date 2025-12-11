# Slides Management Product Spec

## Overview

Add multi-slide functionality to the presentation editor, enabling users to create, navigate, and manage a deck of slides rather than a single slide.

## Current State

- Single `slideHtml` state storing one slide's HTML
- No concept of multiple slides or navigation
- No persistence (state resets on refresh)

---

## Feature Requirements

### 1. Slide Data Model

Replace the single `slideHtml` string with a slides array:

```typescript
interface Slide {
  id: string;          // Unique identifier (uuid)
  html: string;        // Slide HTML content
  thumbnail?: string;  // Optional cached thumbnail (data URL or generated)
}

interface SlidesState {
  slides: Slide[];
  currentSlideIndex: number;
}
```

**Behavior:**
- New presentations start with one empty slide
- `currentSlideIndex` determines which slide is displayed in SlideView
- When the model generates HTML, it updates `slides[currentSlideIndex].html`

---

### 2. Slide Thumbnail Panel

A vertical sidebar on the left side of the screen displaying slide thumbnails, similar to PowerPoint's slide sorter.

**Layout:**
- Fixed width sidebar (~180px)
- Scrollable when slides exceed viewport height
- Each thumbnail shows a miniature preview of the slide
- Current slide highlighted with accent border
- Slide numbers displayed below each thumbnail

**Thumbnail Rendering:**
- Option A: CSS transform scale-down of actual slide HTML
- Option B: Generate static image snapshots (html2canvas or similar)
- Recommended: Start with Option A (CSS scaling) for simplicity

**Thumbnail Interactions:**
- Click thumbnail to navigate to that slide
- Visual hover state on thumbnails

---

### 3. Slide Navigation

#### Keyboard Navigation

| Key | Action |
|-----|--------|
| `ArrowLeft` or `ArrowUp` | Previous slide |
| `ArrowRight` or `ArrowDown` | Next slide |
| `Home` | First slide |
| `End` | Last slide |

**Behavior:**
- Navigation wraps at boundaries (optional, configurable)
- Keyboard events only active when chat input is not focused
- Visual feedback when navigating (smooth scroll in thumbnail panel)

#### Button Navigation

Add navigation buttons below or adjacent to the main slide view:

```
[ < Prev ]  Slide 3 of 10  [ Next > ]
```

**Button States:**
- Prev disabled on first slide
- Next disabled on last slide
- Display current position: "Slide X of Y"

---

### 4. Add/Remove Slides

#### Add Slide Button

- Located at bottom of thumbnail panel: `[ + Add Slide ]`
- Creates new blank slide after current slide
- Navigates to the new slide automatically
- New slide starts with empty HTML or a placeholder

#### Remove Slide Button

- Small delete icon (X) on each thumbnail, visible on hover
- Confirmation not required (undo can be added later)
- Cannot delete the last remaining slide (minimum 1 slide)
- After deletion, navigate to previous slide (or next if deleting first)

#### Keyboard Shortcuts for Slides

| Key | Action |
|-----|--------|
| `Ctrl/Cmd + M` | Add new slide after current |
| `Delete` or `Backspace` | Delete current slide (when not in input) |

---

### 5. UI Layout Changes

**Current Layout:**
```
+------------------------------------------+
|                                          |
|              [SlideView]                 |
|                                          |
+------------------------------------------+
|            [ChatInput]                   |
+------------------------------------------+
```

**New Layout:**
```
+--------+--------------------------------+
|        |                                |
| Thumb  |         [SlideView]            |
| Panel  |                                |
|        |    [ < Prev ] 3/10 [ Next > ]  |
|        |                                |
| [+Add] |                                |
+--------+--------------------------------+
|              [ChatInput]                |
+--------+--------------------------------+
```

**Responsive Considerations:**
- Thumbnail panel collapses to icon-only or hidden on narrow viewports
- Mobile: Consider swipe gestures for navigation instead of keyboard

---

### 6. Component Structure

#### New Components

```
app/src/components/
├── ThumbnailPanel/
│   ├── ThumbnailPanel.tsx      # Container for all thumbnails
│   ├── ThumbnailPanel.css
│   ├── SlideThumbnail.tsx      # Individual thumbnail with delete button
│   └── SlideThumbnail.css
├── SlideNavigation/
│   ├── SlideNavigation.tsx     # Prev/Next buttons + position indicator
│   └── SlideNavigation.css
```

#### Modified Components

- **App.tsx**: Manage `slides` array and `currentSlideIndex` state
- **SlideView.tsx**: No changes (still receives single `html` prop)

#### New Hook

```
app/src/hooks/
└── useSlideNavigation.ts       # Keyboard event handling for navigation
```

---

### 7. State Flow

```
User clicks thumbnail
    → setCurrentSlideIndex(clickedIndex)
    → SlideView renders slides[currentSlideIndex].html
    → ThumbnailPanel highlights new current slide

User presses ArrowRight
    → useSlideNavigation hook intercepts
    → setCurrentSlideIndex(current + 1)
    → Same render flow as above

User sends chat message
    → callClaude() with current slide's HTML as context
    → Response updates slides[currentSlideIndex].html
    → SlideView and thumbnail both re-render

User clicks "Add Slide"
    → Insert new Slide object at currentSlideIndex + 1
    → setCurrentSlideIndex(currentSlideIndex + 1)
    → New blank slide displayed

User deletes slide
    → Remove slide from array
    → Adjust currentSlideIndex if needed
    → Re-render thumbnail panel
```

---

### 8. Styling Guidelines

Follow existing design system:

- **Thumbnail panel background**: `var(--panel-bg)` (#f4ebdf)
- **Selected thumbnail border**: `var(--accent)` (#6ea16a)
- **Hover states**: Slightly darker background, cursor pointer
- **Delete button**: Muted color, red on hover
- **Navigation buttons**: Match existing button styling from ChatInput
- **Transitions**: 150-200ms for hover/selection states

---

### 9. Edge Cases

| Scenario | Behavior |
|----------|----------|
| Delete only slide | Disabled/prevented |
| Navigate past last slide | Stop at boundary (no wrap) |
| Navigate before first slide | Stop at boundary (no wrap) |
| Add slide with 100+ slides | Allow (consider performance later) |
| Chat while loading | Navigation still works |
| Empty slide thumbnail | Show placeholder or slide number |

---

### 10. Future Considerations (Out of Scope)

- Drag-and-drop reordering of slides
- Duplicate slide
- Slide templates
- Persistence (localStorage or backend)
- Undo/redo for slide operations
- Presentation mode (fullscreen, auto-advance)
- Export to PDF/PPTX

---

## Implementation Order

1. **Phase 1: Data Model**
   - Update App.tsx state from `slideHtml` to `slides` array
   - Pass `slides[currentSlideIndex].html` to SlideView
   - Ensure Claude integration still works with new structure

2. **Phase 2: Thumbnail Panel**
   - Create ThumbnailPanel and SlideThumbnail components
   - Implement CSS-scaled thumbnail rendering
   - Add click-to-navigate functionality

3. **Phase 3: Navigation**
   - Add SlideNavigation component (prev/next buttons)
   - Implement useSlideNavigation hook for keyboard events
   - Wire up navigation to state

4. **Phase 4: Add/Remove**
   - Add "Add Slide" button to thumbnail panel
   - Add delete button to thumbnails
   - Implement keyboard shortcuts

5. **Phase 5: Polish**
   - Animations and transitions
   - Responsive adjustments
   - Edge case handling
