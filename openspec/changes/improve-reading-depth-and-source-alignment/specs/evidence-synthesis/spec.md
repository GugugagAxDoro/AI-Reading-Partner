## MODIFIED Requirements

### Requirement: Evidence-driven retrieval decisions
The system SHALL distinguish author-intent gaps, missing local material, explanatory gaps, external factual uncertainty, and freshness or explicit-web requirements. Current-book evidence SHALL be preferred for identifying the author's meaning, but ability to paraphrase that evidence SHALL NOT establish that an explanation is complete or a claim correct. Relevant project materials SHALL remain within the permitted project. When web access is enabled, specific unsupported explanatory needs, materially questionable claims, disputed assumptions, outdated facts, and explicit verification needs SHALL trigger targeted external retrieval. Explicit web and current-fact requests SHALL NOT be short-circuited by generic cached answers. Straightforward fully supported explanations without a material verification need SHALL avoid unnecessary search. An author-intent gap SHALL NOT be filled by attributing external views to the author, and web-off SHALL remain a hard boundary.

#### Scenario: Local definition is sufficient
- **WHEN** local evidence supports an adequate explanation including its relevant conditions and no external verification need exists
- **THEN** the answer explains the concept without external search or page reading

#### Scenario: Missing earlier definition
- **WHEN** a passage refers to a definition elsewhere in the book
- **THEN** targeted current-book retrieval precedes treating external definitions as the author's meaning

#### Scenario: Project fallback
- **WHEN** the current book lacks relevant explanation and another permitted project book contains it
- **THEN** the answer can retrieve and cite that book without searching unrelated projects

#### Scenario: Current external fact
- **WHEN** the user asks for a current value, latest practice, factual verification, or explicitly requests web research
- **THEN** the system attempts targeted external retrieval without requiring irrelevant project searches first

#### Scenario: Confident but questionable passage
- **WHEN** a passage makes a material universal claim that the available evidence does not justify
- **THEN** the system identifies the verification need and, when web is enabled, seeks relevant independent evidence rather than treating fluent book wording as proof

### Requirement: Conflict-aware answers
The system SHALL examine disagreements by definition, date, assumptions, method, and source quality, with bounded targeted verification where useful. Neither the book's authority nor web recency or result ranking SHALL automatically determine correctness. Author intent SHALL remain grounded in the book, while factual analysis SHALL be allowed to identify book errors, omissions, and one-sided conclusions. Relevant primary research, standards, regulators, and specialist sources SHALL be preferred where applicable; unavailable or weak evidence SHALL remain explicitly limited. Important disputed details SHALL NOT be presented as fully verified from snippets alone. Unresolved differences SHALL retain references and conditions rather than fabricated consensus or repetitive source-by-source recaps.

#### Scenario: Different definitions explain a disagreement
- **WHEN** a book uses benchmark alpha and a page describes risk-model alpha
- **THEN** the answer explains the differing baseline instead of declaring one source wrong or collapsing the definitions

#### Scenario: Conflict cannot be resolved
- **WHEN** conflicting reliable claims remain after permitted verification
- **THEN** the answer states the disagreement and its conditions with references rather than inventing consensus

#### Scenario: Book statement is materially incomplete
- **WHEN** credible evidence demonstrates that a book conclusion omits a material assumption
- **THEN** the answer explains the author's argument and the missing assumption, with sources attached to the respective supported claims

#### Scenario: Network verification is forbidden or fails
- **WHEN** a questionable external claim cannot be checked because web is off or retrieval fails
- **THEN** the answer preserves supported reasoning and the specific unresolved uncertainty without claiming independent verification

## ADDED Requirements

### Requirement: Precise evidence location and support
Document references SHALL identify the actual PDF page or page range and available passage anchor supporting the cited claim, rather than substitute a section's first page. Excerpts that cross pages SHALL retain their page boundaries. Repeated text SHALL NOT be assigned an arbitrary unique location. Known source IDs SHALL establish identity only, not certify factual support. Existing records with inaccurate or incomplete locations SHALL remain readable; only uniquely resolved corrections SHALL become precise targets, with original record provenance preserved. Unknown locations SHALL be visibly unresolved instead of represented as verified page numbers.

#### Scenario: Growth-investment page regression
- **WHEN** a cited passage spans PDF pages 41 and 42 inside a section starting on page 26
- **THEN** references navigate to the actual cited passage on pages 41 or 42, or show the verified span, and never label or navigate to page 26 solely because it begins the section

#### Scenario: Legacy inaccurate location
- **WHEN** an old reference points to a section start but its excerpt can be uniquely resolved elsewhere in the same document
- **THEN** its resolved location uses the true page while the old answer text and original source identity remain recoverable without a model call

#### Scenario: Ambiguous repeated passage
- **WHEN** the same excerpt occurs in several locations and surrounding context cannot distinguish them
- **THEN** the reference exposes unresolved location instead of asserting one match as exact

#### Scenario: Unrelated but registered source
- **WHEN** an answer cites a known source that does not support its adjacent claim
- **THEN** content-level reference evaluation fails rather than accepting the citation merely because its ID exists
