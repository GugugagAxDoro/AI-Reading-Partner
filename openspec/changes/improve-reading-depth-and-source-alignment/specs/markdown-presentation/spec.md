## MODIFIED Requirements

### Requirement: Unified inline source references
The system SHALL render validated claim-linked references consistently in conversation answers, cached explanations, summaries, research outputs, and note reading views. Document references SHALL display a book icon followed by the verified PDF page label, such as `P41` or `P41–42`; unresolved locations SHALL display `原文` with an explicit location-unverified detail. Web references SHALL display a globe icon followed by a short readable page title, falling back to the domain when the title is absent. Visible labels SHALL NOT be candidate-list sequence numbers. Stable source IDs SHALL remain independent of labels, and distinct source locations SHALL remain navigable. Assistive labels SHALL identify source type, title, and location. References SHALL replace repetitive provenance narration in answer text.

#### Scenario: Mixed first-sentence references
- **WHEN** a definition has document and web support
- **THEN** its adjacent references show book icon plus verified page and globe icon plus short web information, without numeric source-list labels or provenance lead-ins

#### Scenario: Same source cited again
- **WHEN** multiple claims cite the same verified location or web page
- **THEN** the source identity and readable label are reused without creating duplicate source records

#### Scenario: PDF versus printed pagination
- **WHEN** a PDF's physical page index differs from printed book pagination
- **THEN** `Pxx` uses the same one-based PDF page coordinate as reader navigation and source details identify that convention

### Requirement: Reference inspection and navigation
The system SHALL expose full document title and verified page or section location, or full web title and domain, through pointer and keyboard-accessible reference details. Long web labels SHALL be end-elided within a bounded inline width without expanding a narrow sidebar; the full information SHALL remain inspectable. Clicking a document reference SHALL open the correct permitted document at the verified page and available passage anchor, including other books in the same project. An unresolved reference SHALL NOT masquerade as an exact page jump. Web references SHALL open validated URLs safely. Inspection SHALL not cause clipping, incoherent overlap, text reflow, or loss of keyboard focus during streaming or rerendering.

#### Scenario: Cross-book navigation
- **WHEN** a user activates a verified reference to another project book
- **THEN** that book opens at the cited location without replacing the originating conversation scope or messages

#### Scenario: Keyboard inspection
- **WHEN** a user focuses a reference without a pointer
- **THEN** its type, full title, and location are inspectable and activation targets the same destination as clicking

#### Scenario: Long web label in a narrow sidebar
- **WHEN** an answer with a long mixed Chinese and Latin web title is displayed in a 300px sidebar
- **THEN** the title is safely end-elided, the icon remains visible, and full source details remain inside the viewport

#### Scenario: Historical source labels
- **WHEN** an existing answer contains a numeric marker label
- **THEN** the renderer derives the current readable label from validated source metadata without rewriting historical Markdown or silently claiming an unverified page

## ADDED Requirements

### Requirement: Consistent human-readable source export
Copying, saving, or exporting answers, notes, and mind-map sources SHALL preserve full readable provenance and verified locations even when in-app web labels are shortened. Document labels SHALL follow PDF pagination and disclose unresolved positions. Existing stable links and Markdown footnotes SHALL remain compatible; export-local footnote numbering SHALL NOT be mistaken for PDF page numbers. Unsafe URLs, unknown sources, and unavailable books SHALL remain non-executable and visibly unavailable. Absolute local filesystem paths SHALL NOT be exposed.

#### Scenario: Export shortened web reference
- **WHEN** a source label is shortened in the reading sidebar and its answer is copied or exported
- **THEN** the exported source retains the full title and validated URL rather than only the visually truncated label

#### Scenario: Export a cross-page document reference
- **WHEN** a note with a verified page-range citation is saved and exported to a mind map
- **THEN** the source retains its readable book title, page range, and stable application locator without implying an embedded offline PDF
