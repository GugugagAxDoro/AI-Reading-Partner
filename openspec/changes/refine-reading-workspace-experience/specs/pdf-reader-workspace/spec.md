## MODIFIED Requirements

### Requirement: Text selection anchoring
The system SHALL capture selected PDF text with its page, normalized content, character offsets when available, and a stable selection hash for AI actions and caching. Each sent message SHALL retain an immutable copy of its full quote and source anchor, independent of subsequent selections or the reader's current page.

#### Scenario: Select text
- **WHEN** the user selects a nonempty text range in the rendered PDF
- **THEN** the AI panel receives the selected text and stable anchor data and presents available actions

#### Scenario: Empty selection
- **WHEN** the selection is empty or contains only whitespace
- **THEN** AI selection actions are unavailable

#### Scenario: Turn pages after selection
- **WHEN** a user selects text on one page, navigates elsewhere, and sends the anchored quote
- **THEN** the request and stored message retain the selected page and text rather than the current navigation page

## ADDED Requirements

### Requirement: Desktop selection action popover
The system SHALL show a small interactive vocabulary/deep-interpretation popover near a completed nonempty desktop text selection. It SHALL prefer space above the selection, fall below when necessary, stay within the visible reading region, and preserve the selection snapshot when clicked. Scrolling, reselecting, cancelling selection, and Escape SHALL dismiss stale popovers. Sidebar shortcuts SHALL remain available; a custom mobile selection popover is not required in this change.

#### Scenario: Click popover shortcut
- **WHEN** the user selects text and clicks a nearby shortcut
- **THEN** exactly one matching template request starts and its answer appears in the right-side conversation without requiring pointer travel to that sidebar

#### Scenario: Edge or multiline selection
- **WHEN** a multiline selection ends near a reading-region edge
- **THEN** the popover uses a visible selection rectangle, remains inside that region, and does not intercept native selection before selection completion

#### Scenario: Dismiss without losing draft
- **WHEN** the user scrolls or presses Escape after selecting text
- **THEN** the floating popover closes without clearing an already attached composer quote or typed question

### Requirement: Historical quote navigation
The system SHALL allow a conversation's stored page reference to locate its source text where available and SHALL retain a missing-source state when the source is unavailable. Viewing a historic quote SHALL NOT silently replace the current composer quote or invoke a model.

#### Scenario: Follow historical citation
- **WHEN** a user clicks a past message's page reference after navigating elsewhere
- **THEN** the reader returns to the saved page and indicates the source passage where resolvable without generating a new answer
