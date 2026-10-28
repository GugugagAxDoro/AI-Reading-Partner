## Purpose

Make reading answers depend on relevant, traceable evidence rather than retrieval volume, combining book and external information without repetition while preserving meaningful uncertainty, provenance, and unresolved contradictions.

## ADDED Requirements

### Requirement: Evidence-driven retrieval decisions
The system SHALL distinguish author-intent gaps, missing local material, external conceptual or factual gaps, and freshness or explicit-web requirements. It SHALL use current-book evidence first when applicable, retrieve other project documents only when relevant and permitted, and invoke web tools only for a concrete external need. Explicit web requests and time-sensitive external facts SHALL require an external-evidence attempt when web access is enabled, even if a model or cached generic answer claims sufficiency. A local author-intent gap SHALL NOT be filled with an invented claim about the book derived from web content.

#### Scenario: Local definition is sufficient
- **WHEN** the selected passage and nearby book text sufficiently define the term and the question has no external requirement
- **THEN** the answer uses the local evidence with zero external searches and zero page reads

#### Scenario: Missing earlier definition
- **WHEN** a passage refers to a definition elsewhere in the book
- **THEN** targeted current-book retrieval precedes treating general external definitions as the author's meaning

#### Scenario: Project fallback
- **WHEN** the current book lacks relevant explanation and another permitted project book contains it
- **THEN** the answer can retrieve and cite that book without searching unrelated projects

#### Scenario: Current external fact
- **WHEN** the user asks for a current value, latest practice, factual verification, or explicitly requests web research
- **THEN** the system attempts targeted external retrieval without requiring irrelevant project searches first

### Requirement: Traceable evidence and coverage
The system SHALL associate evidence with stable source identities, source kind, document location or URL, excerpt, retrieval time when applicable, and the question or claim it supports. Sufficiency SHALL depend on relevance and coverage of the actual question, not only result count or one model confidence flag. Summaries and previous AI answers SHALL NOT be treated as independently verified primary evidence.

#### Scenario: Many irrelevant results
- **WHEN** many retrieved passages do not address a requested claim
- **THEN** that claim remains unsupported and triggers a targeted next step or an explicit unresolved limitation

#### Scenario: Mixed author and external interpretation
- **WHEN** external material clarifies a concept that the book discusses
- **THEN** the answer connects the useful explanations while source references preserve which statements are supported by which materials

### Requirement: Non-redundant synthesis
The system SHALL merge materially identical or similar claims into a single explanation with appropriate supporting references, combine complementary details into a coherent answer, and avoid separate repetitive book-versus-web recaps. Reposts and near-identical copies SHALL NOT inflate the apparent number of independent supporting sources. Deduplication SHALL preserve differences in definitions, dates, conditions, measurements, and conclusions.

#### Scenario: Book and two sites explain the same concept
- **WHEN** three sources support the same definition with overlapping wording
- **THEN** the answer states the definition once and attaches the useful references without three restatements

#### Scenario: Apparent duplicates contain different assumptions
- **WHEN** similar claims apply to different benchmarks or time periods
- **THEN** those differences survive deduplication and appear where needed for an accurate answer

### Requirement: Conflict-aware answers
The system SHALL examine material disagreements by definition, date, assumptions, method, and source quality, perform bounded targeted verification when it can resolve the disagreement, and retain unresolved differences. Neither book authority nor web recency SHALL automatically determine factual correctness. Claims about author intent SHALL remain grounded in the book.

#### Scenario: Different definitions explain a disagreement
- **WHEN** a book uses benchmark alpha and a page describes risk-model alpha
- **THEN** the answer explains the differing baseline instead of declaring one source wrong or collapsing the definitions

#### Scenario: Conflict cannot be resolved
- **WHEN** conflicting reliable claims remain after the permitted verification budget
- **THEN** the answer concisely states the disagreement and its conditions with references instead of inventing consensus

### Requirement: Freshness-aware reuse
The system SHALL distinguish retention from freshness: web evidence SHALL be retained for at most 180 days, while suitability for reuse SHALL depend on the question's freshness needs, evidence age, and explicit refresh intent. Unknown freshness SHALL NOT support a claim of current verification. A failed required external check SHALL remain visible and SHALL NOT create a reusable complete answer for that external requirement.

#### Scenario: Old definition versus current question
- **WHEN** a retained definition is still suitable for a conceptual question but too old for a latest-status question
- **THEN** only the conceptual question can reuse it without fresh verification

#### Scenario: Web outage with partial local support
- **WHEN** required web verification fails but the book supports part of the answer
- **THEN** the supported portion is answered, the unresolved external part is identified without fabrication, and the failure is recorded separately from evidence
