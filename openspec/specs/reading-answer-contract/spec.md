# reading-answer-contract Specification

## Purpose
Provide a shared, versioned answer contract for reading questions, shortcut explanations, research, and summaries, with direct openings, concise useful expansion, claim-linked references, and consistent behavior across streaming and completion paths.
## Requirements
### Requirement: Versioned prompt separation
The system SHALL maintain independently identifiable base rules, retrieval and evidence policy, task instructions, and answer-format contract. Reading material and tool output SHALL remain distinguishable from controlling instructions. Each generation SHALL record the effective prompt versions, and task templates SHALL NOT contradict the effective web policy. Existing lightweight and strong model tiers SHALL remain available without introducing task-specific provider roles.

#### Scenario: Prompt policy update
- **WHEN** retrieval or answer-format instructions change
- **THEN** the generation records the new applicable versions and old stored answers retain their original version metadata

#### Scenario: Instruction inside a book
- **WHEN** selected text includes an instruction to ignore safeguards or alter output policy
- **THEN** it is interpreted as quoted book content, not as authority over the application or the user's actual question

### Requirement: Direct task-specific opening
The system SHALL begin a vocabulary explanation with a single sentence in the form `词汇：定义。`, preserving the selected term's appropriate spelling. For example, `Alpha：相对于选定基准或风险模型所解释收益之外的超额收益。` Deep interpretation SHALL begin with a short paragraph directly explaining the passage's central meaning or conclusion. Custom questions SHALL begin with the answer to the actual question. There SHALL be no introductory title, salutation, quotation block, or service-status warning before the answer; reference markers attached to the first answer are allowed. If evidence cannot support a definition or conclusion, the opening SHALL state the precise limitation instead of fabricating compliance.

#### Scenario: Vocabulary opening
- **WHEN** the user requests an explanation of Alpha with sufficient evidence
- **THEN** the first visible prose is the term and one-sentence definition, without “这里的”, “指的是”, or a “一句话解释” heading

#### Scenario: Deep interpretation opening
- **WHEN** the user asks for deep interpretation of a supported passage
- **THEN** the answer starts with a compact direct explanation before any optional elaboration

#### Scenario: Network unavailable
- **WHEN** an external check fails but some answer is locally supported
- **THEN** the supported direct answer comes first and a separate status indicator exposes the unavailable check

### Requirement: Concise optional expansion
The system SHALL include only expansion that materially helps understanding, such as a needed example, assumption, distinction, reasoning step, or unresolved conflict. It SHALL NOT pad answers to a fixed section count or add source-announcement filler such as “根据上下文”, “根据网络资料”, “下面为你解释”, or templated “不是……而是……” contrasts when a direct statement suffices. This rule SHALL NOT delete necessary negation, quoted source wording, meaningful qualifications, or the actual semantic difference between conflicting claims. References SHALL carry provenance instead of repetitive source-announcement prose.

#### Scenario: Simple concept
- **WHEN** a one-sentence definition fully answers the vocabulary request
- **THEN** the answer can end after that sentence and its references without background, examples, or a repeated conclusion

#### Scenario: Necessary limitation
- **WHEN** a definition depends on a benchmark or an interpretation is uncertain
- **THEN** the condition or uncertainty remains explicit and concise rather than being removed as unwanted wording

### Requirement: Shared completion and streaming contract
All newly generated final answers, including direct answers, agent free-text completion, finish-tool completion, and limit-reached synthesis, SHALL follow the same task contract and reference validation. Streaming SHALL remain incremental without requiring the entire answer to be buffered as one JSON document. Cancelled partial output SHALL remain identifiable as incomplete. Unknown source IDs SHALL NOT become fabricated links. A contract violation SHALL NOT cause unbounded model retries or silent destructive regex rewriting of the answer.

#### Scenario: Alternate agent exit
- **WHEN** an agent completes through free text or an explicit finish action
- **THEN** it obeys the same direct-opening, concise-content, and source-validation rules as a normal reading answer

#### Scenario: Partial reference during streaming
- **WHEN** a stream temporarily ends inside a reference marker
- **THEN** the view remains usable and resolves only complete validated references without losing accumulated text

### Requirement: Faithful summary and artifact content
The system SHALL keep book and chapter base summaries faithful to their source material and separate from external research and Dynamic Notes. Summary prompts SHALL apply concise expression without forcing the vocabulary-answer opening. External research notes and mind maps SHALL retain supporting reference identities, and generating an artifact SHALL NOT bypass note-write confirmation rules.

#### Scenario: Background chapter summary
- **WHEN** a chapter summary is generated while the user reads
- **THEN** the summary reflects the chapter rather than importing unrelated web findings from the reading conversation

#### Scenario: Save a researched answer
- **WHEN** a completed mixed-source answer is saved as a note and used to generate a mind map
- **THEN** its source associations remain available and a substantial rewrite of an existing note still requires confirmation
