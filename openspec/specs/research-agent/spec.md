# research-agent Specification

## Purpose

Provides a constrained, tool-using agent that can gather evidence from the current book, project, and configured web search, then produce notes and mind maps.

## Requirements

### Requirement: Constrained agent execution
The system SHALL execute agent tasks through an explicit tool set with a configurable execution limit defaulting to eight rounds, and SHALL stop within those limits.

#### Scenario: Task completes
- **WHEN** an agent gathers sufficient evidence before reaching its execution limit
- **THEN** it returns a cited answer or requested artifact

#### Scenario: Limit reached
- **WHEN** the configured maximum rounds are exhausted
- **THEN** the agent answers from evidence already collected and states remaining gaps

#### Scenario: Tool visibility
- **WHEN** an agent performs a tool step
- **THEN** the UI shows a concise timeline entry and complete run details are retained in the agent run directory

### Requirement: Retrieval fallback order
The system SHALL search the current document first, then project documents, then the configured web search when local evidence is insufficient or web search is explicitly requested.

#### Scenario: Current-document evidence
- **WHEN** the current document contains sufficient evidence
- **THEN** the agent answers without searching the project or web

#### Scenario: Project fallback
- **WHEN** current-document evidence is insufficient and project search is allowed
- **THEN** the agent searches other documents in the project and cites cross-document sources

#### Scenario: Web fallback
- **WHEN** project evidence remains insufficient and web search is enabled
- **THEN** the agent searches through the configured SearXNG provider and cites web sources

### Requirement: Web search privacy
The system SHALL send only agent-generated queries and necessary request parameters to SearXNG, not whole-book content or user-selected passages.

#### Scenario: Search query construction
- **WHEN** the agent decides to search the web
- **THEN** the outgoing request contains the generated query and search settings, not the full document

### Requirement: SearXNG result processing
The system SHALL parse SearXNG results, fetch selected web page content, extract readable title/body/source metadata, and retain results for at most 180 days.

#### Scenario: Fetch page
- **WHEN** the agent identifies a search result as useful
- **THEN** it may fetch and summarize the page body while retaining the source URL and fetch time

#### Scenario: Expired cache
- **WHEN** a cached web result is older than 180 days
- **THEN** it is marked stale and is refreshed or deprioritized before being used as current evidence

### Requirement: Evidence quality judgment
The system SHALL evaluate retrieved evidence for relevance and sufficiency before deciding whether to answer or expand retrieval.

#### Scenario: Reject irrelevant results
- **WHEN** top results only weakly match the user's concepts
- **THEN** the agent does not treat them as sufficient final evidence and may continue retrieval

#### Scenario: Mixed-source answer
- **WHEN** an answer combines document and web evidence
- **THEN** each claim is attributed to its local or web source

### Requirement: Markdown note tools
The system SHALL let the agent create notes automatically, append small updates automatically, and require confirmation for rewrites or deletions.

#### Scenario: Create note
- **WHEN** an agent produces a durable research output and no matching note exists
- **THEN** it creates a Markdown note in the project artifacts directory

#### Scenario: Small append
- **WHEN** an agent adds a limited insight to an existing note
- **THEN** the append is applied automatically and a new note version is saved

#### Scenario: Rewrite or delete
- **WHEN** an agent needs to replace substantial note content or delete a note
- **THEN** the user must confirm before the operation is applied

### Requirement: Note versioning and editing
The system SHALL store note history and allow users to edit AI-created notes directly.

#### Scenario: Manual edit
- **WHEN** a user modifies a note
- **THEN** the updated Markdown is saved with a new version and prior content remains recoverable

#### Scenario: View history
- **WHEN** the user opens note history
- **THEN** prior versions can be inspected and restored

### Requirement: Bidirectional link insertion
The system SHALL allow the agent to insert stable links to terms, notes, documents, sections, and web sources, and SHALL make those links clickable in rendered notes. A backlink panel SHALL NOT be required in this phase.

#### Scenario: Automatic link
- **WHEN** an agent creates or updates a note and identifies a related term or note
- **THEN** it may insert a stable link into the Markdown

#### Scenario: Link click
- **WHEN** the user clicks a rendered link
- **THEN** the app navigates to the linked term explanation, note, document location, section, or web source

#### Scenario: Missing target
- **WHEN** a linked source has been deleted
- **THEN** the link remains visible as a missing-source state and is not silently removed

### Requirement: Mind map generation
The system SHALL generate a Markmap-compatible HTML view from a Markdown note and allow users to view it in the app or export the HTML file.

#### Scenario: Generate mind map
- **WHEN** the user requests a mind map for a Markdown note
- **THEN** the system creates an HTML mind map based on the note's heading and list structure

#### Scenario: Export mind map
- **WHEN** the user chooses export
- **THEN** the mind map HTML is saved in the project artifacts directory and can be opened independently

#### Scenario: Note update
- **WHEN** a linked note changes
- **THEN** the user can regenerate its mind map from the latest note version

### Requirement: Deleted-source references
The system SHALL retain references to permanently deleted books and mark them as missing rather than deleting dependent notes or links.

#### Scenario: Reference becomes missing
- **WHEN** a book used by a note or term cache is permanently deleted
- **THEN** affected references are shown as missing source and remain editable

#### Scenario: Reimport same document
- **WHEN** the same document hash is reimported
- **THEN** compatible references and progress can be restored from the missing-source state

### Requirement: Unified research conversation
The system SHALL expose reading questions and research through one conversation composer, attach research runs and their output to the initiating conversation message, and display an expandable tool timeline within that message. Existing current-book/project/web fallback order, per-conversation web-disable control, tool limits, source retention, and note-write confirmation requirements SHALL remain effective.

#### Scenario: Research through the composer
- **WHEN** a question is routed or explicitly submitted for research
- **THEN** one user message owns the run, its timeline, citations, and final Markdown answer without creating a second input workflow

#### Scenario: Web search disabled
- **WHEN** web search is disabled for the conversation
- **THEN** no web search or web fetch occurs and insufficient local evidence is stated rather than silently bypassing that preference

#### Scenario: Note confirmation survives redesign
- **WHEN** research proposes a substantial rewrite or deletion of a note
- **THEN** the conversation presents confirmation and no destructive write occurs until the user approves
