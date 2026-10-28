## MODIFIED Requirements

### Requirement: Terminology cache
The system SHALL store vocabulary explanations at project scope and reuse them for the same normalized term only when the current contextual sense, effective answer/prompt versions, history association, and evidence policy are compatible. A compatible independent conceptual hit SHALL require no model or web call. An explicit current-verification request SHALL NOT be satisfied by an unverified generic hit. Old or incompatible entries SHALL remain inspectable without being silently rewritten.

#### Scenario: Cache hit
- **WHEN** a user selects a term with a compatible project-level explanation for the same sense and no new external-verification need
- **THEN** the cached explanation is returned without a new model request or search

#### Scenario: Repeat occurrence marker
- **WHEN** a term has an existing compatible explanation and occurs elsewhere in the project
- **THEN** its occurrence is visibly marked and the user can open that explanation directly without duplicate text rendering

#### Scenario: Different contextual sense
- **WHEN** the same spelling denotes materially different concepts in two books
- **THEN** the prior explanation is not silently reused as the new sense and both entries remain distinguishable

### Requirement: Content explanation cache
The system SHALL store selected-passage explanations at document scope using document identity, page and available anchor, normalized passage, action or instruction, effective prompt/answer versions, and relevant evidence-policy compatibility. Changed instructions, required freshness, history association, or evidence completeness SHALL prevent incompatible automatic reuse. Historical explanations SHALL remain viewable.

#### Scenario: Passage cache hit
- **WHEN** the same action is requested for the same passage and all relevant compatibility conditions match
- **THEN** the existing explanation is reused without model or external calls

#### Scenario: Different action
- **WHEN** the same passage is used with a different action or materially different custom instruction
- **THEN** a distinct compatible cache entry is required

#### Scenario: Partial answer after outage
- **WHEN** an answer completes with a required external claim still unverified
- **THEN** it remains in conversation history but does not populate a reusable complete explanation cache

### Requirement: Context assembly and token control
The system SHALL assemble minimal relevant context under one request-level budget covering base rules, tool definitions, current question and selection, explicit history, evidence, reserved output, and a safety margin. It SHALL avoid whole-book input and independently bound stored-history inclusion: template actions and independent questions in smart mode SHALL include zero prior conversation messages. Lower-priority history and redundant evidence SHALL be removed before protected question and essential selection. External evidence SHALL consume space only when retrieved for a concrete need rather than permanently reserving unused web context.

#### Scenario: Selected-passage request
- **WHEN** the user asks about a selected passage
- **THEN** necessary nearby text, section information, and relevant source excerpts are used without blindly including every available summary or cached explanation

#### Scenario: Book-level question
- **WHEN** the user asks about the whole book
- **THEN** relevant chunks and summaries are retrieved rather than uploading every page

#### Scenario: Missing context
- **WHEN** evidence cannot support a requested claim after allowed retrieval
- **THEN** the answer directly states that specific gap rather than inventing document content

#### Scenario: Protected input exceeds budget
- **WHEN** the current question and essential selection cannot fit after optional context is removed
- **THEN** the user is asked to narrow the selection or question before model work rather than receiving silently truncated input

#### Scenario: Independent question after long history
- **WHEN** many earlier messages exist and smart mode receives a new independent question
- **THEN** those messages do not enter planning, query generation, or final answering context

### Requirement: Default web evidence for reading questions
The system SHALL default to automatic, evidence-driven web use for uncached reading questions and selected-text actions when the conversation permits web access, replacing mandatory search. A locally sufficient answer SHALL make no search or page-read request. External facts, freshness needs, and explicit web requests SHALL trigger targeted MCP retrieval when permitted; irrelevant or empty results SHALL NOT be inserted merely to make the answer appear sourced. Relevant web evidence SHALL fit the shared input budget and retain validated references. Compatible cached conceptual explanations SHALL remain viewable without a new search. Required-search failure SHALL preserve supported local answering, separately expose the unavailable check, and prevent incomplete explanation-cache writes.

#### Scenario: Combined reading answer
- **WHEN** a question needs both a book claim and external clarification and relevant search evidence is available
- **THEN** the answer integrates them without repeating equivalent content and attaches references to the supported claims

#### Scenario: Direct question search outage
- **WHEN** a required search is unavailable during a normal reading question
- **THEN** the answer starts with supported local information, a distinct status reports the unavailable check, and unresolved external facts are not invented

#### Scenario: Disabled web
- **WHEN** the conversation disables web access
- **THEN** ordinary, shortcut, and research requests make no external search or page-read request and do not silently override that preference

#### Scenario: Local-only shortcut
- **WHEN** nearby book text is sufficient for a vocabulary explanation or passage interpretation
- **THEN** the shortcut follows its direct-answer format without mandatory external search or a separate planning/judging round

## ADDED Requirements

### Requirement: Summary evidence boundary
The system SHALL generate base book, chapter, and project summaries from the corresponding permitted documents and their faithful intermediate summaries. Reading-conversation web evidence and Dynamic Notes SHALL NOT silently modify those summaries. Requests to research beyond a source summary SHALL produce a separately identifiable researched answer or artifact with references.

#### Scenario: Summary after external research
- **WHEN** a user researches an external example and later opens a chapter base summary
- **THEN** the base summary remains faithful to the chapter and the external example stays in its conversation or separate note
