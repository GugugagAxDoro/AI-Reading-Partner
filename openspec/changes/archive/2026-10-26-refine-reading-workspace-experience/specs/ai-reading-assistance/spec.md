## MODIFIED Requirements

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

## ADDED Requirements

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
