# pdf-reader-workspace Specification

## Purpose

Renders supported PDFs in a three-pane workspace where users can navigate, inspect, and select text for AI actions.

## Requirements

### Requirement: Three-pane workspace
The system SHALL present a directory/summary/notes panel, a central PDF reader, and an AI interaction panel in the reading workspace.

#### Scenario: Open a ready book
- **WHEN** a user opens a ready PDF
- **THEN** the workspace displays all three panes and focuses the central reader

#### Scenario: Responsive layout
- **WHEN** the viewport is too narrow for the desktop layout
- **THEN** the panes remain usable without overlapping or clipping text

### Requirement: Text PDF rendering and navigation
The system SHALL render text-layer PDFs using continuous scrolling and SHALL support previous-page, next-page, page input, and scroll-position navigation.

#### Scenario: Page navigation
- **WHEN** the user requests the next or previous page
- **THEN** the reader moves to the adjacent page and updates the current page indicator

#### Scenario: Direct page jump
- **WHEN** the user enters a valid page number
- **THEN** the reader navigates to that page without reloading the whole document

### Requirement: Outline navigation
The system SHALL display the PDF's native outline when available or an AI-generated outline when native outline data is insufficient.

#### Scenario: Native outline available
- **WHEN** an imported PDF contains outline destinations
- **THEN** the directory tab shows the hierarchy with titles and page targets

#### Scenario: Outline click
- **WHEN** the user clicks an outline item
- **THEN** the reader navigates to that item's target page and updates progress

### Requirement: Text selection anchoring
The system SHALL capture selected PDF text with its page, normalized content, character offsets when available, and a stable selection hash for AI actions and caching. Each sent message SHALL retain an immutable copy of its full quote and source anchor, independent of subsequent selections or the reader's current page.

#### Scenario: Select text
- **WHEN** the user selects a nonempty text range in the rendered PDF
- **THEN** the AI panel receives the selected text and stable anchor data and presents available actions

#### Scenario: Empty selection
- **WHEN** the selection is empty or contains only whitespace
- **THEN** AI selection actions are unavailable

#### Scenario: Turn pages after selection
- **WHEN** a user selects text on one page, navigates elsewhere, and sends the anchored quote
- **THEN** the request and stored message retain the selected page and text rather than the current navigation page

### Requirement: Text-layer status
The system SHALL classify a PDF as a text PDF, mixed PDF, or scanned PDF using extracted text volume and page characteristics.

#### Scenario: Text PDF accepted
- **WHEN** most pages contain extractable text
- **THEN** the book is marked as a text PDF and reading and AI features are enabled

#### Scenario: Scanned PDF rejected
- **WHEN** a PDF is classified as scanned
- **THEN** the app explains that this phase requires a text layer and does not start AI processing

#### Scenario: Mixed PDF
- **WHEN** some pages lack meaningful text
- **THEN** the app permits reading and AI actions on text-bearing pages while marking low-text pages as having limited AI context

### Requirement: Reading progress
The system SHALL save the reader's current page and approximate scroll offset and restore it when the user reopens the same book in the same project.

#### Scenario: Leave and return
- **WHEN** the user reads to page 83, closes the reader, and later reopens the book from the same project
- **THEN** the reader restores approximately the same location

### Requirement: Cached vocabulary marker presentation
The system SHALL mark cached vocabulary occurrences with a visible background without painting duplicate text over the rendered PDF. Markers SHALL preserve text selection and direct access to the cached explanation at supported reading scales.

#### Scenario: Read and open a cached vocabulary occurrence
- **WHEN** a cached vocabulary occurrence is displayed at normal or enlarged reading scale and clicked
- **THEN** the original PDF text remains free of ghost glyphs, the vocabulary remains selectable, and its cached explanation opens without a model request

### Requirement: Desktop selection action popover
The system SHALL show a small interactive vocabulary/deep-interpretation popover near a completed nonempty desktop text selection. It SHALL prefer space above the selection, fall below when necessary, stay within the visible reading region, and preserve the selection snapshot when clicked. Scrolling, reselecting, cancelling selection, and Escape SHALL dismiss stale popovers. Sidebar shortcuts SHALL remain available; a custom mobile selection popover is not required in this change.

#### Scenario: Click popover shortcut
- **WHEN** the user selects text and clicks a nearby shortcut
- **THEN** exactly one matching template request starts and its answer appears in the right-side conversation without requiring pointer travel to that sidebar

#### Scenario: Edge or multiline selection
- **WHEN** a multiline selection ends near a reading-region edge
- **THEN** the popover uses a visible selection rectangle, remains inside that region, and does not intercept native selection before selection completion

#### Scenario: Dismiss without losing draft
- **WHEN** the user scrolls or presses Escape after selecting text
- **THEN** the floating popover closes without clearing an already attached composer quote or typed question

### Requirement: Historical quote navigation
The system SHALL allow a conversation's stored page reference to locate its source text where available and SHALL retain a missing-source state when the source is unavailable. Viewing a historic quote SHALL NOT silently replace the current composer quote or invoke a model.

#### Scenario: Follow historical citation
- **WHEN** a user clicks a past message's page reference after navigating elsewhere
- **THEN** the reader returns to the saved page and indicates the source passage where resolvable without generating a new answer
