## MODIFIED Requirements

### Requirement: Selected-text actions
The system SHALL offer vocabulary explanation, content interpretation, and custom questions for selected text, with shortcuts labeled 词汇解释 and 深度解读. One-click translation SHALL NOT be offered in this phase. Shortcuts SHALL immediately send their versioned request using a frozen selection and append the question and answer to the active conversation without requiring a second send. Normal vocabulary and interpretation requests SHALL provide substantive explanation after their direct openings, while user-specified brevity or custom instructions remain authoritative. Useful background and critical analysis SHALL be evidence-driven rather than automatic web research for every request.

#### Scenario: Vocabulary explanation
- **WHEN** the user selects a word or short phrase and invokes vocabulary explanation
- **THEN** the answer defaults to Simplified Chinese with a direct definition and useful explanation, source references, and compatible project-level caching

#### Scenario: Content interpretation
- **WHEN** the user invokes interpretation on a selected passage
- **THEN** the answer explains meaning and reasoning after a direct opening, identifies relevant assumptions and limitations, and can incorporate targeted external verification where needed and permitted

#### Scenario: Custom question
- **WHEN** the user selects text and enters a custom instruction
- **THEN** the answer addresses that instruction using the selected context instead of forcing the default explanation template

#### Scenario: Template distinction
- **WHEN** the user invokes either shortcut without a brevity restriction
- **THEN** vocabulary focuses on understanding the concept and interpretation on understanding and assessing the passage, neither ending after a bare definition or paraphrase solely because the opening must be concise

## ADDED Requirements

### Requirement: Depth-compatible answer reuse
Reusable answers SHALL be compatible with the effective explanation-depth and evidence-verification policy as well as existing sense, action, version, scope, and history boundaries. Earlier single-sentence answers SHALL remain viewable but SHALL NOT silently satisfy a new default detailed request when incompatible. Explicit regeneration SHALL create a new attempt without deleting prior answers. Partial, cancelled, failed, or unverified required checks SHALL NOT become reusable complete explanations, and cache hits SHALL retain working references and range records without model or network calls.

#### Scenario: Earlier short vocabulary cache
- **WHEN** a default detailed vocabulary request encounters a cache produced under the previous single-sentence contract
- **THEN** the old record remains inspectable but is not reused as a compatible detailed answer

#### Scenario: Compatible repeated request
- **WHEN** the same sense and request have a complete compatible detailed explanation
- **THEN** the answer and its source associations are reused without model or external calls

### Requirement: Durable passage record association
Interpretation and custom-answer records SHALL retain immutable document identity, action, full source selection, and resolvable location independently of the current page and composer. Complete records SHALL support their original anchored occurrence, while project vocabulary reuse SHALL continue to respect contextual sense. Failed or cancelled attempts SHALL remain distinguishable from complete historical explanations. Reloading or viewing records SHALL NOT create new messages, caches, notes, or model requests. Existing unanchored records SHALL remain available through a record list when precise highlighting cannot be resolved.

#### Scenario: Reload completed passage history
- **WHEN** a user reopens a book containing a completed anchored interpretation or custom answer
- **THEN** the appropriate marker and saved answer are available at the original range without changing the initiating conversation's scope or creating new data

#### Scenario: Incomplete attempt
- **WHEN** an answer was cancelled or failed after partial generation
- **THEN** it remains inspectable as incomplete and is not marked as a complete reusable explanation

#### Scenario: Legacy record lacks a precise anchor
- **WHEN** a historical answer cannot be uniquely matched to its source text
- **THEN** it remains accessible from history with unresolved location rather than an invented precise highlight
