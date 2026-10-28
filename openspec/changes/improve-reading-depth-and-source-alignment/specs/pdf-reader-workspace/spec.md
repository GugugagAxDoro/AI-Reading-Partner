## MODIFIED Requirements

### Requirement: Cached vocabulary marker presentation
The system SHALL mark compatible cached vocabulary occurrences with a warm-gold dotted underline instead of a permanent filled background. Hovering or focusing SHALL expose the applicable range with a subtle temporary highlight and an accessible explanation label. Markers SHALL NOT paint duplicate text, change glyph positions, or modify selection contents. They SHALL support direct cached access at supported reading scales and remain distinguishable from passage interpretation and custom-question records without relying solely on hue.

#### Scenario: Read and open a cached vocabulary occurrence
- **WHEN** a cached vocabulary occurrence is displayed at normal or enlarged scale and activated
- **THEN** its dotted underline aligns with the actual term, the original text remains selectable and free of ghost glyphs, and the cached explanation opens without a model or search request

#### Scenario: Term split across text items
- **WHEN** a term contains Latin letters or punctuation and spans multiple text items
- **THEN** its verified occurrence is marked at the correct range without broadening the highlight to unrelated text or inserting duplicate glyphs

## ADDED Requirements

### Requirement: Passage history markers
Completed deep-interpretation and custom-question records SHALL be visibly marked at their saved source ranges. Deep interpretation SHALL use a blue solid underline and custom questions a muted violet dashed underline, as the proposed default visual scheme. Markers SHALL be distinct from vocabulary dotted underlines and SHALL NOT turn whole passages into permanent colored blocks. Hovering or focusing SHALL expose type and range; activation SHALL open existing records without regeneration. Multiple records for the same range SHALL remain individually accessible. Overlapping markers SHALL use a non-stacked alternative such as a passage-margin indicator rather than obscure text or vocabulary marks. Users SHALL be able to hide history markers without deleting data.

#### Scenario: Two actions on one passage
- **WHEN** a passage has both a completed interpretation and completed custom answers
- **THEN** one accessible combined range indicator exposes the two action types and their record list without overlapping lines or automatic model calls

#### Scenario: Vocabulary inside an interpreted paragraph
- **WHEN** a cached term lies within an interpreted passage
- **THEN** the term's dotted underline remains clear and the passage marker uses a non-overlapping representation while both records remain accessible

#### Scenario: Hide and restore markers
- **WHEN** a user toggles history marker visibility
- **THEN** PDF text and selection remain unchanged and all stored records survive hiding and restoring

### Requirement: Aligned PDF text selection and annotations
Rendered PDF glyphs, selectable text, vocabulary marks, and passage marks SHALL share consistent page geometry at supported reader zooms, browser pixel ratios, and pane widths. Latin letters, digits, symbols, punctuation, ligatures, and CJK mixtures SHALL NOT introduce cumulative horizontal drift or wrong-line highlights. Resizing, zooming, scrolling, page virtualization, and font loading SHALL not retain stale mark geometry. Historical decorations SHALL NOT alter the text layer's text content or layout. The system SHALL preserve text extraction and selection semantics without OCR or replacing selectable text with image recognition. Unresolvable anchors SHALL remain visibly unresolved rather than highlight a guessed range.

#### Scenario: Mixed-script selection
- **WHEN** a user selects a known Chinese passage containing `EBITDA`, `Alpha`, percentages, brackets, and mathematical symbols
- **THEN** the selected characters and their visible range correspond to the intended glyphs and saved marks return to that same range without cumulative drift

#### Scenario: Rescale and resize
- **WHEN** an annotated page is zoomed, moved between wide and narrow pane layouts, or revisited after virtualization
- **THEN** selections and marks align with the new rendering geometry without duplicated decorations or stale offsets

#### Scenario: Repeated identical text
- **WHEN** an anchored passage has repeated text elsewhere on the page
- **THEN** only the uniquely resolved saved occurrence is marked and ambiguity is surfaced instead of highlighting the first textual match

#### Scenario: Mark-free layout equivalence
- **WHEN** history markers are added to or removed from an already rendered page
- **THEN** the selectable text, underlying glyph rendering, and base text-item layout remain unchanged
