# research-agent Specification

## Purpose

Provides a constrained, tool-using agent that can gather evidence from the current book, project, and configured web search, then produce notes and mind maps.
## Requirements
### Requirement: Constrained agent execution
The system SHALL execute agent tasks through an explicit permission-filtered tool set with a configurable execution limit defaulting to eight rounds. Total model calls, tool calls, input/output token consumption, elapsed time, and retries SHALL also be bounded across the complete request, including planning, query rewriting, judging, and final synthesis. Simple supported requests SHALL NOT require a separate planner or judge call. Budget exhaustion and repeated no-progress retrieval SHALL stop further expansion and return supported conclusions with remaining gaps, reserving final-answer capacity when feasible.

#### Scenario: Task completes
- **WHEN** an agent gathers sufficient evidence before reaching its execution limit
- **THEN** it returns a cited answer or requested artifact through the shared answer contract

#### Scenario: Limit reached
- **WHEN** the configured rounds, calls, token limit, or total deadline is exhausted
- **THEN** no new expansion starts and the task returns a bounded supported answer with remaining gaps or an explicit terminal timeout when final generation cannot run

#### Scenario: Tool visibility
- **WHEN** an agent performs a tool step
- **THEN** the UI shows a concise timeline entry and complete redacted run details are retained in the agent run directory without exposing private reasoning

#### Scenario: No progress
- **WHEN** successive retrievals produce no relevant new evidence or repeat an equivalent query over unchanged evidence
- **THEN** the harness suppresses duplicate work and stops expansion rather than looping until all rounds are consumed

### Requirement: Retrieval fallback order
The system SHALL use an evidence-driven retrieval policy rather than mandatory local-and-web prefetch. Current-document evidence SHALL be preferred for book interpretation; insufficient local coverage SHALL permit targeted current-document and then relevant project retrieval. Web access enabled SHALL mean permission to retrieve when needed, not an obligation to search. External factual gaps, freshness requirements, and explicit web requests SHALL trigger targeted MCP retrieval when enabled without requiring irrelevant local steps. Disabling web search for a conversation SHALL prevent both external search and page fetch.

#### Scenario: Current-document evidence
- **WHEN** the current document sufficiently answers a question without an external requirement
- **THEN** the agent answers with no web or project search and no mandatory extra planning call

#### Scenario: Project fallback
- **WHEN** current-document evidence is insufficient and relevant project search is allowed
- **THEN** the agent searches other documents in the project and cites cross-document sources

#### Scenario: Web fallback
- **WHEN** the task requires outside evidence and web access is enabled
- **THEN** the agent uses the configured MCP search capability and combines useful findings with local context under the shared evidence-synthesis rules

#### Scenario: Search unavailable
- **WHEN** MCP or search fails due to startup failure, connection refusal, timeout, HTTP failure, invalid results, or unavailable engines
- **THEN** the task preserves supported local answers, identifies unverified external claims, and does not repeatedly retry unavailable search during that run

#### Scenario: User cancels during search
- **WHEN** the user stops the task while a search is pending
- **THEN** the upstream operation is cancelled on a best-effort basis and the task stays cancelled rather than continuing through fallback

### Requirement: Web search privacy
The system SHALL send only agent-generated queries and necessary request parameters to SearXNG, not whole-book content or user-selected passages.

#### Scenario: Search query construction
- **WHEN** the agent decides to search the web
- **THEN** the outgoing request contains the generated query and search settings, not the full document

### Requirement: SearXNG result processing
The system SHALL process bounded SearXNG results through MCP, read selected useful pages through the controlled MCP page tool, preserve readable title/body/source metadata and evidence type, and retain results for at most 180 days. Reuse SHALL additionally satisfy the request's freshness needs; retention alone SHALL NOT establish freshness.

#### Scenario: Fetch page
- **WHEN** a result is useful and its snippet does not sufficiently support the needed claim
- **THEN** the agent can read a validated page with its source URL, retrieval time, and fetched-page identity retained

#### Scenario: Expired cache
- **WHEN** a cached web result is older than 180 days
- **THEN** it is no longer retained as reusable page content and any historical reference remains visible without being presented as fresh evidence

#### Scenario: Recent evidence still unsuitable
- **WHEN** a request requires newer evidence than an otherwise retained result provides
- **THEN** fresh verification is attempted instead of treating the retention window as a freshness guarantee

### Requirement: Evidence quality judgment
The system SHALL assess evidence relevance, question coverage, duplication, freshness, and material conflict before expanding retrieval or completing an answer. Deterministic checks and the main agent SHALL suffice for simple cases; a separate judging call SHALL only be used when its expected value justifies its cost and SHALL share the request budget. The final context SHALL preserve necessary conflicting and complementary evidence rather than favoring only early-arriving results.

#### Scenario: Reject irrelevant results
- **WHEN** top results only weakly match the user's concepts
- **THEN** they do not satisfy the missing claim and the agent performs a targeted next step or states the gap

#### Scenario: Mixed-source answer
- **WHEN** an answer combines document and web evidence
- **THEN** claims retain source references, overlapping explanations are merged, and material disagreements are analyzed rather than hidden

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
The system SHALL expose reading questions and research through one conversation composer, attach research runs and output to the initiating conversation message, and display an expandable concise tool timeline within that message. Evidence-driven retrieval, per-conversation web-disable control, execution budgets, source retention, and note-write confirmation SHALL remain effective. The original selection anchor, question, and explicitly associated history SHALL remain separately identifiable throughout execution rather than being flattened into an ambiguous task string.

#### Scenario: Research through the composer
- **WHEN** a question enters tool-assisted research
- **THEN** one user message owns the run, timeline, citations, and final Markdown answer without a second input workflow

#### Scenario: Web search disabled
- **WHEN** web search is disabled for the conversation
- **THEN** no web search or page fetch occurs, local evidence is used where sufficient, and unresolved external requirements remain explicit

#### Scenario: Note confirmation survives redesign
- **WHEN** research proposes a substantial rewrite or deletion of a note
- **THEN** the conversation presents confirmation and no destructive write occurs until the user approves

#### Scenario: Trace the selected passage
- **WHEN** a research answer is generated from a selection
- **THEN** its final references and run metadata retain the original document, page, and available paragraph anchor

### Requirement: Complete tool protocol and bounded context
The system SHALL preserve native assistant-tool call/result associations and validated structured-plan equivalence through execution and context compaction. Every proposed native tool call SHALL receive exactly one correlated result or explicit rejection outcome; silently dropping calls SHALL NOT corrupt the conversation protocol. Model inputs SHALL stay within one effective request budget with protected current question and selection, bounded explicit history, and structured evidence excerpts. Tool content SHALL NOT be truncated in a way that breaks its structured meaning.

#### Scenario: Too many proposed calls
- **WHEN** a model proposes more tool calls than the remaining execution allowance
- **THEN** permitted calls execute, excess calls receive explicit budget-rejection outcomes, and the next model request remains protocol-valid

#### Scenario: Context compaction
- **WHEN** accumulated observations exceed the input allowance
- **THEN** completed tool exchanges are compacted atomically into traceable evidence and all retained calls still have matching results

### Requirement: Recoverable and auditable execution
The system SHALL durably record request identity, effective policies and versions, selected-source anchors, retrieval decisions with concise reasons, tool outcomes, evidence references, total model usage, and terminal state. It SHALL NOT store private chain-of-thought or secrets. Usage SHALL include all model calls, mark unavailable provider usage as unknown or estimated, and avoid presenting partial accounting as a complete total. Interrupted work SHALL become a recoverable explicit terminal state without replaying note writes or launching duplicate requests.

#### Scenario: Judge and synthesis usage
- **WHEN** a run invokes planning, a judge, and synthesis
- **THEN** the reported totals include every invocation and identify estimates or missing usage

#### Scenario: Restart after a note write
- **WHEN** the service restarts after a note is created but before final answer completion
- **THEN** the prior write remains identifiable and retry cannot silently create another copy
