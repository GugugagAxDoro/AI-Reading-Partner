## Purpose

Provide a quiet, professional reading interface with consistent neutral surfaces, restrained accent colors, ergonomic responsive navigation, persistent panel preferences, and accessible controls throughout the library and reader.

## ADDED Requirements

### Requirement: Restrained visual system
The system SHALL use the approved light gray/white, graphite-text, low-saturation green-accent design consistently across the library, reader, conversations, summaries, notes, and menus. Controls SHALL use consistent spacing, typography, focus, disabled, pending, and error states; destructive actions SHALL NOT have equal prominence to primary reading actions.

#### Scenario: Inspect normal and exceptional states
- **WHEN** normal, empty, pending, failed, disabled, and focused states are displayed
- **THEN** text and controls remain legible and consistent without overlapping surfaces or relying solely on color for status

### Requirement: Responsive panel preferences
The system SHALL allow desktop sidebars to be resized and collapsed within constraints that keep the reader usable, persist those preferences locally, and provide mobile directory/conversation drawers rather than a long stacked desktop layout. Closing a drawer SHALL return focus and reading position without discarding drafts.

#### Scenario: Resize and restore
- **WHEN** a user changes sidebar widths or visibility and reloads
- **THEN** valid preferences are restored and the central reader remains usable at the current viewport

#### Scenario: Mobile drawers
- **WHEN** a user opens and closes directory or conversation drawers on a narrow screen
- **THEN** content fits the viewport, only the active modal drawer receives focus, and reading position and draft text survive

### Requirement: Accessible controls and input
The system SHALL provide labeled icon controls with tooltips, visible keyboard focus, keyboard-operable menus and drawers, and accessible dynamic status. Enter SHALL send and Shift+Enter SHALL insert a newline; input-method composition SHALL NOT trigger sending. Error messages SHALL preserve user input and identify a recovery action.

#### Scenario: Chinese composition
- **WHEN** the user presses Enter to confirm a Chinese input-method candidate
- **THEN** no message is submitted until composition has ended and a separate send action occurs

#### Scenario: Keyboard navigation
- **WHEN** a keyboard user opens a menu, interacts, and dismisses it with Escape
- **THEN** controls are labeled, focus is visible, and focus returns to the initiating control
