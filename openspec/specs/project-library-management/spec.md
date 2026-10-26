# project-library-management Specification

## Purpose

Provides the project-oriented library where users organize PDF books, monitor import and analysis status, and preserve reading progress.

## Requirements

### Requirement: Project management
The system SHALL allow users to create, rename, and delete projects, and SHALL list projects with their contained-book counts and latest activity.

#### Scenario: Create a project
- **WHEN** a user submits a valid project name
- **THEN** the project is created and appears in the project list

#### Scenario: Delete a project
- **WHEN** a user confirms deletion of a project
- **THEN** the project's project-scoped caches, notes, mind maps, agent runs, and progress records are removed without deleting the globally shared parsed document record

### Requirement: PDF import
The system SHALL allow users to import PDF files into a project and SHALL process imports asynchronously without blocking the management UI.

#### Scenario: Successful import
- **WHEN** a user selects a valid PDF for import
- **THEN** the system computes a stable document hash, stores the source PDF, extracts a cover and metadata, and shows the book with an import status

#### Scenario: Duplicate import
- **WHEN** a user imports a PDF whose document hash already exists
- **THEN** the system reuses the shared parsed document and adds it to the selected project without duplicating the source file

### Requirement: Book status and metadata
The system SHALL display each book with title, author when available, page count, cover preview, text-layer status, processing status, last-read time, and reading progress.

#### Scenario: Import completes
- **WHEN** PDF extraction, outline construction, chunking, indexing, and macro summary processing finish
- **THEN** the book is marked ready and its processing timeline reflects completion

#### Scenario: Processing failure
- **WHEN** any import processing stage fails
- **THEN** the book remains visible with a failed status, the failing stage is identified, and the user can retry processing

### Requirement: Book removal behavior
The system SHALL distinguish removing a book from a project and permanently deleting a book.

#### Scenario: Remove from project
- **WHEN** a user removes a book from one project
- **THEN** the global document and its parsed data remain available to other projects

#### Scenario: Permanently delete book
- **WHEN** a user confirms permanent deletion
- **THEN** the document source, parsed data, index records, document-scoped caches, and reading progress are removed, while project references and notes are retained but marked as having a missing source

### Requirement: Reading progress persistence
The system SHALL persist per-project reading progress by current page and approximate scroll position.

#### Scenario: Reopen a book
- **WHEN** a user reopens a book within a project
- **THEN** the reader restores the last saved page and scroll position

#### Scenario: Progress update
- **WHEN** the user navigates to a new location
- **THEN** the book card and reader reflect the updated page and percentage after the progress is saved

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
