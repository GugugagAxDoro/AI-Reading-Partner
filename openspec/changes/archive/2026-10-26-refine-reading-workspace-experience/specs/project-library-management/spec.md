## ADDED Requirements

### Requirement: Library discovery and continued reading
The system SHALL support title search and sorting by recent reading, recently added, and title within the selected project. A continue-reading action SHALL restore saved progress; cover previews SHALL retain the complete page image within their bounds.

#### Scenario: Search and sort
- **WHEN** a user searches a title and changes sort order
- **THEN** only matching books from the selected project appear in the requested stable order and empty matches are distinguished from an empty project

#### Scenario: Continue reading
- **WHEN** a user opens a previously read book through continue reading
- **THEN** the saved project-specific page and scroll offset are restored

### Requirement: Localized status and safe library actions
The system SHALL present localized book/job statuses and stage-specific progress, expose secondary and destructive actions in an accessible menu, and retain confirmation for permanent deletion. Import or summary failure SHALL NOT block reading otherwise usable text pages or unrelated books.

#### Scenario: Permanent deletion remains deliberate
- **WHEN** the user opens a book's action menu and chooses permanent deletion
- **THEN** a confirmation is required and cancelling leaves all data intact

#### Scenario: Failed background summary
- **WHEN** a summary task fails for a readable book
- **THEN** the failure and retry action are shown locally while the reader remains available
