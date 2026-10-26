## Purpose

Present model answers, summaries, research results, and note previews as consistently formatted and safe Markdown while retaining document navigation, missing-source visibility, and unmodified source content.

## ADDED Requirements

### Requirement: Shared Markdown presentation
The system SHALL render headings, emphasis, ordered and unordered nested lists, quotations, rules, fenced code, links, tables, and task lists consistently across conversation answers, cached answers, book/chapter/project summaries, research results, and note previews. Wide tables and code SHALL scroll inside their own region rather than expanding the workspace.

#### Scenario: All Markdown surfaces
- **WHEN** the same Markdown fixture is displayed in each supported surface
- **THEN** equivalent semantic elements appear instead of literal formatting markers and nested lists retain hierarchy

#### Scenario: Incomplete streamed Markdown
- **WHEN** a stream temporarily ends inside a code fence, list, or emphasis marker
- **THEN** the page remains usable without executing content or losing the accumulated text, and final formatting is correct after completion

### Requirement: Safe content and source links
The system SHALL NOT execute raw HTML, scripts, event handlers, or unsafe URL schemes from model or note content. Remote images SHALL NOT load automatically. Existing stable term/note/document/section links and page citations SHALL retain validated navigation; deleted sources SHALL remain visible as missing.

#### Scenario: Malicious content
- **WHEN** Markdown contains script tags, event handlers, javascript links, data-URL payloads, or external tracking images
- **THEN** no executable content or automatic external image request occurs

#### Scenario: Resolve live and missing sources
- **WHEN** the user follows a valid reference or views a reference to a deleted source
- **THEN** the valid reference navigates to its target and the deleted one remains visibly unavailable without silent removal

### Requirement: Single-line middle-elided quotations
The system SHALL display composer and message quotations on one line, preserve their beginning and end when eliding the middle, and keep page/source controls visible. The original full text and anchor SHALL remain unchanged in storage and requests. Full quotations SHALL be inspectable with pointer, keyboard, or touch.

#### Scenario: Long multilingual quotation
- **WHEN** a long Chinese quotation containing Latin text and emoji is shown in a narrow sidebar
- **THEN** it fits one line with middle ellipsis, does not split a grapheme, and exposes the complete original text on demand

#### Scenario: Resize quotation
- **WHEN** the sidebar width changes
- **THEN** displayed elision adapts without changing the saved text, request text, or source destination

### Requirement: Note reading and editing modes
The system SHALL open notes in formatted reading mode and allow an explicit switch to Markdown editing, saving, or cancelling. Reading-only presentation SHALL NOT create note versions or alter stored Markdown.

#### Scenario: View then edit
- **WHEN** the user opens a note, enters edit mode, changes Markdown, and saves
- **THEN** reading mode shows the saved formatting and exactly one new version is added

#### Scenario: Cancel edit
- **WHEN** the user cancels an unsaved edit
- **THEN** the stored content, previous versions, and note file remain unchanged
