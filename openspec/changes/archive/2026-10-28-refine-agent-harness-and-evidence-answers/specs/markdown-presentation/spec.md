## ADDED Requirements

### Requirement: Unified inline source references
The system SHALL render validated claim-linked references consistently in new conversation answers, cached explanations, summaries, research outputs, and saved-note reading views. A compact book icon SHALL identify document sources and a globe icon SHALL identify web sources, with a stable reference identifier and an accessible source label. Icons SHALL supplement rather than replace identification for assistive technologies. Sources SHALL be deduplicated by identity while distinct cited locations remain navigable. Source-provenance lead-ins SHALL NOT be required in answer prose.

#### Scenario: Mixed first-sentence references
- **WHEN** a vocabulary definition has local and web support
- **THEN** references appear beside the relevant sentence using the respective icons without a “根据上下文/网络资料” prefix

#### Scenario: Same source cited again
- **WHEN** multiple claims cite the same document location or web page
- **THEN** they reuse the same source identity and reference label rather than duplicating source records

### Requirement: Reference inspection and navigation
The system SHALL expose document title and page or section location, or web title and domain, through pointer and keyboard-accessible reference details. Clicking a document reference SHALL open the correct permitted document and its page or available paragraph anchor, including another book in the same project. Clicking a web reference SHALL open the validated original URL safely. Reference inspection SHALL remain usable in a narrow sidebar without covering or shifting answer text incoherently.

#### Scenario: Cross-book navigation
- **WHEN** the user clicks a reference to another project book
- **THEN** that book opens at the cited location without replacing the originating conversation's stored scope or messages

#### Scenario: Keyboard inspection
- **WHEN** a user focuses a reference without using a pointer
- **THEN** its type, source title, and location are available and activation navigates to the same target as a click

### Requirement: Reference durability and compatibility
The system SHALL persist source identity and target information with answers and preserve them through reload, cache viewing, copying, note saving, and note or mind-map export. Outside the app, document references SHALL retain readable book/location information and a stable app locator rather than leaking a local filesystem path or claiming an unavailable offline PDF is embedded. Web references SHALL retain their URLs. Existing Markdown links and historical page citations SHALL remain readable and navigable where valid without silently regenerating old answers. Deleted, unknown, and inaccessible references SHALL remain visible in an unavailable state rather than becoming fabricated destinations.

#### Scenario: Save and reload
- **WHEN** a mixed-source answer is saved as a note and the application reloads
- **THEN** the note retains matching reference types, source identities, and destinations without re-running the model

#### Scenario: Copy and export
- **WHEN** an answer is copied or a sourced note is exported as Markdown or mind-map HTML
- **THEN** citations retain readable provenance and usable web links, and document targets disclose their app dependency rather than exposing absolute local paths

#### Scenario: Deleted book
- **WHEN** a cited book is permanently removed
- **THEN** its references remain visible as unavailable and do not silently redirect to another book

#### Scenario: Unsafe or invented target
- **WHEN** output includes an unknown source ID or unsafe URL scheme
- **THEN** the reference cannot execute or open that destination and the answer remains readable
