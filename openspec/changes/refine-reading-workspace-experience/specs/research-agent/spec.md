## ADDED Requirements

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
