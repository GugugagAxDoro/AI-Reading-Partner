## MODIFIED Requirements

### Requirement: Direct task-specific opening
The system SHALL begin a vocabulary explanation with one direct sentence in the form `词汇：定义。`, preserving the term's appropriate spelling and necessary qualifications. Deep interpretation SHALL begin with a short paragraph directly explaining the passage's central meaning or conclusion. Custom questions SHALL begin with the answer to the actual question. These openings SHALL introduce rather than replace the substantive explanation required by the task. There SHALL be no introductory title, salutation, quotation block, or service-status warning before the answer; reference markers attached to the opening are allowed. Unsupported definitions or conclusions SHALL be replaced by a precise limitation rather than fabricated compliance.

#### Scenario: Vocabulary opening
- **WHEN** the user requests an explanation of Alpha with sufficient evidence
- **THEN** the answer starts with `Alpha：` and a one-sentence definition without an introductory heading, and then explains the useful concepts and conditions beyond that opening

#### Scenario: Deep interpretation opening
- **WHEN** the user requests deep interpretation of a supported passage
- **THEN** a compact direct explanation precedes a substantive account of its reasoning, mechanisms, assumptions, and relevant limitations rather than merely paraphrasing the passage

#### Scenario: Network unavailable
- **WHEN** an external check fails but some answer is locally supported
- **THEN** the supported direct answer comes first, supported explanation continues, and a separate status exposes the unavailable check without inventing external findings

### Requirement: Concise optional expansion
The system SHALL provide substantive explanation by default after the direct opening. Vocabulary explanations SHALL cover the meaning and useful applicable dimensions, including mechanism, calculation, example, use, distinctions, and limitations where material; deep interpretations SHALL explain the argument, causal steps, assumptions, and relevant counterexamples or boundary conditions. The system SHALL adapt depth to the concept and actual user question rather than require a second request to expand or impose a universal one-sentence or two-paragraph ceiling. Explicit requests for brevity SHALL take priority. Optional dimensions SHALL be omitted when unhelpful, not filled with padding or unsupported anecdotes. The system SHALL NOT require fixed section counts, repetitive conclusions, source-announcement filler, or meaningless rhetorical contrasts. Necessary negation, quoted wording, qualifications, and uncertainty SHALL remain intact, with references carrying provenance.

#### Scenario: Simple concept
- **WHEN** a user requests a normal vocabulary explanation of a simple concept
- **THEN** a compact useful explanation follows the definition, such as a contextual distinction or example, without manufacturing formulae or a lengthy background section

#### Scenario: Necessary limitation
- **WHEN** a definition depends on a benchmark or an interpretation is uncertain
- **THEN** the condition or uncertainty remains explicit and is explained enough to prevent a misleading conclusion

#### Scenario: EBITDA explanation
- **WHEN** the user asks for EBITDA without a brevity restriction and supporting evidence is available
- **THEN** the answer explains its name, calculation with accounting assumptions, a correct numerical example, useful comparisons, and why it does not equal operating or free cash flow, without unverifiable quotations or claims of universally equivalent accounting formulae

#### Scenario: Explicit short answer
- **WHEN** the user explicitly asks for only one sentence
- **THEN** the answer respects that restriction while retaining indispensable qualifications and available references

## ADDED Requirements

### Requirement: Reproducible content-quality acceptance
Answer quality SHALL be evaluated against fixed Chinese cases with expected concepts, required conditions, prohibited errors, retrieval needs, and supporting sources defined before generation. Acceptance SHALL distinguish content accuracy, explanatory completeness, relevance, reference support, and direct expression from structural correctness alone. Real-provider evaluations SHALL retain all attempts and compare the existing and proposed behavior, with human review of factual and reasoning failures. Failed cases SHALL drive bounded revisions and related-case plus fixed-suite regression, not cherry-picked successful samples or indefinite retries. Missing external dependencies SHALL be reported separately rather than counted as quality passes.

#### Scenario: Shallow but well-formed answer
- **WHEN** an answer has valid Markdown and known reference IDs but omits the case's essential mechanism or limitation
- **THEN** the content evaluation fails even though the format checks pass

#### Scenario: Misleading qualification
- **WHEN** an answer explains that high win rate does not guarantee profit but incorrectly makes missing sample or fee data a prerequisite for that mathematical distinction
- **THEN** semantic review records a reasoning failure and the affected case is re-evaluated after revision

#### Scenario: Real-model comparison
- **WHEN** a prompt, evidence policy, or output budget is revised
- **THEN** the report retains baseline and revised outputs, all attempts, effective versions, model and tool counts, latency, usage accounting, and per-case review rather than only an aggregate pass count
