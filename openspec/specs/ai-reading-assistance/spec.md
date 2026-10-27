# ai-reading-assistance Specification

## Purpose

Provides cache-aware AI explanation, interpretation, summarization, and project-scoped concept reuse while controlling token consumption.

## Requirements

### Requirement: Selected-text actions
The system SHALL offer vocabulary explanation, content interpretation, and custom question actions for selected text, labeled 词汇解释 and 深度解读 for the two shortcuts. One-click translation SHALL NOT be offered in this phase. A shortcut SHALL immediately send its versioned template request using a frozen selection and append the question and answer to the active conversation; it SHALL NOT require a second send action.

#### Scenario: Vocabulary explanation
- **WHEN** the user selects a word or short phrase and chooses vocabulary explanation
- **THEN** the system returns a Simplified Chinese explanation with source context and caches it for project reuse

#### Scenario: Content interpretation
- **WHEN** the user selects a passage and chooses content interpretation
- **THEN** the system returns a Simplified Chinese explanation grounded in the selected passage and minimal local context

#### Scenario: Custom question
- **WHEN** the user selects text and enters a custom instruction
- **THEN** the system answers using that instruction and the selected-text context

#### Scenario: Template distinction
- **WHEN** the user invokes either shortcut
- **THEN** vocabulary explanation covers contextual meaning and necessary background, while deep interpretation covers the claim, reasoning, assumptions, and difficulties without automatically becoming a web research task

### Requirement: Default answer language
The system SHALL default AI answers to Simplified Chinese while allowing a user prompt to override the language for that request.

#### Scenario: Default behavior
- **WHEN** a user invokes an AI action without specifying a language
- **THEN** the answer is produced in Simplified Chinese

#### Scenario: User override
- **WHEN** a user requests an answer in another language
- **THEN** that request overrides the default for that interaction

### Requirement: Terminology cache
The system SHALL store vocabulary explanations at project scope and reuse them when the same normalized term occurs in any document in that project.

#### Scenario: Cache hit
- **WHEN** a user selects a term that already has a project-level explanation
- **THEN** the cached explanation is returned without a new model request

#### Scenario: Repeat occurrence marker
- **WHEN** a term has an existing explanation and occurs elsewhere in the project
- **THEN** its occurrence is visibly marked and the user can open the existing explanation directly

### Requirement: Content explanation cache
The system SHALL store selected-passage explanations at document scope using the document, page, normalized passage, and action or instruction.

#### Scenario: Passage cache hit
- **WHEN** the user requests the same action for the same normalized passage in the same document
- **THEN** the cached explanation is reused instead of sending a new model request

#### Scenario: Different action
- **WHEN** the same passage is used with a different action or materially different custom instruction
- **THEN** a distinct cache entry is used

### Requirement: Summary hierarchy
The system SHALL generate a book macro summary during import, a chapter summary when the user first enters a chapter, and a project summary on demand.

#### Scenario: Book macro summary
- **WHEN** a book import completes enough processing to identify its structure
- **THEN** a concise macro summary is generated in the background and shown in the summary tab

#### Scenario: Chapter summary
- **WHEN** the user enters a chapter for the first time and no chapter summary exists
- **THEN** a chapter summary task starts in the background and the UI shows its pending state

#### Scenario: Project summary
- **WHEN** the user requests a project summary
- **THEN** the system synthesizes project-level themes and relationships from member-book summaries and current project data

### Requirement: Dynamic Notes separation
The system SHALL preserve AI-derived reading insights as Dynamic Notes that remain separate from stable book and chapter base summaries.

#### Scenario: Save insight
- **WHEN** the user confirms that an answer should become a Dynamic Note
- **THEN** it is stored as a standalone note and is not merged into the chapter base summary

### Requirement: Context assembly and token control
The system SHALL assemble the minimum relevant local context for each AI request, apply request-type token budgets, include source references, and avoid sending whole books. Conversation history SHALL be independently bounded, with zero history for template actions and independent questions in smart mode. Total input SHALL respect both the configured application ceiling and the model context window with reserved output and safety margin; lower-priority history and evidence SHALL be removed before protected current question and selection.

#### Scenario: Selected-passage request
- **WHEN** the user asks about a selected passage
- **THEN** the context includes the passage, nearby text, section title, relevant summary, and limited cached knowledge rather than the entire document

#### Scenario: Book-level question
- **WHEN** the user asks a question about the whole book
- **THEN** the system retrieves the most relevant chunks and summaries instead of uploading every page

#### Scenario: Missing context
- **WHEN** sufficient local context is unavailable
- **THEN** the response explicitly identifies the information gap rather than inventing document content

#### Scenario: Protected input exceeds budget
- **WHEN** the current question and essential selection cannot fit after optional context is removed
- **THEN** the user is asked to narrow the selection or question before any model request, rather than receiving silently truncated input

### Requirement: History-sensitive cache reuse
The system SHALL preserve project-wide terminology and passage-scoped cache behavior for independent actions. Context-dependent follow-ups SHALL NOT reuse an independent answer or another history context's answer. Changed template versions SHALL NOT silently replace historical answers; explicit regeneration SHALL create a new answer attempt with its version recorded.

#### Scenario: Cache hit in a conversation
- **WHEN** an independent shortcut finds a valid compatible cache entry
- **THEN** the cached answer appears with a cache label and source references without a model call or implicit follow-up association

#### Scenario: Same question with different parent
- **WHEN** identical question text follows two different answers
- **THEN** neither request can incorrectly reuse the other's context-dependent cached answer

#### Scenario: Regenerate after template update
- **WHEN** the user explicitly regenerates an older cached explanation
- **THEN** the current template is used while existing conversation messages and original answer metadata remain intact

### Requirement: Default web evidence for reading questions
The system SHALL supplement uncached reading questions and selected-text actions with at most three search results by default when the conversation enables web access. Network evidence SHALL fit within the existing input budget, retain source URLs, and be distinguished from document content. Complete current questions and selections SHALL remain protected. Compatible cached explanations SHALL remain viewable without a new search. Failed searches SHALL NOT prevent local answers or populate reusable explanation caches with degraded results.

#### Scenario: Combined reading answer
- **WHEN** an uncached question has local context and available search results
- **THEN** bounded local and web evidence are both available to the model and source references remain attached to the answer

#### Scenario: Direct question search outage
- **WHEN** search is unavailable during a normal reading question
- **THEN** the model answers from the bounded local context and the displayed answer includes a clear network-unavailable notice

#### Scenario: Disabled web
- **WHEN** the conversation disables web access
- **THEN** ordinary and shortcut questions make no external search request
