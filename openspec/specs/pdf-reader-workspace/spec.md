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
The system SHALL capture selected PDF text with its page, normalized content, character offsets when available, and a stable selection hash for AI actions and caching.

#### Scenario: Select text
- **WHEN** the user selects a nonempty text range in the rendered PDF
- **THEN** the AI panel receives the selected text and stable anchor data and presents available actions

#### Scenario: Empty selection
- **WHEN** the selection is empty or contains only whitespace
- **THEN** AI selection actions are unavailable

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
