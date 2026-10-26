# reading-conversations Specification

## Purpose

Provide durable book-scoped reading conversations with streamed answers, explicit follow-up relationships, predictable recovery, and bounded model-history context independent of stored message history.

## Requirements

### Requirement: Book-scoped conversation persistence
The system SHALL persist conversations under a project and document, support creating and switching conversations, and restore the most recently active conversation and ordered messages after reload. Requests SHALL validate project, document, conversation, and message membership; an inactive conversation's responses SHALL NOT appear in the active conversation.

#### Scenario: Reload and switch
- **WHEN** a user sends messages, creates another conversation, and reloads the reader
- **THEN** both conversations remain available and the last active conversation is restored with its own messages

#### Scenario: Scope isolation
- **WHEN** a request supplies a conversation or parent message belonging to another project or document
- **THEN** it is rejected without invoking a model or exposing messages from the other scope

#### Scenario: Inactive conversation completes
- **WHEN** the user switches conversations while an answer is generated
- **THEN** the answer is stored only in its originating conversation and cannot replace the active conversation's content

### Requirement: Conversation composer and message controls
The system SHALL display a scrollable message history above a persistent bottom composer. It SHALL support questions without selections, selection-based questions, message-level follow-up, copying completed answers, and saving completed answers as standalone notes. Starting a new conversation SHALL NOT erase earlier records.

#### Scenario: Read older messages
- **WHEN** a user scrolls away from the latest message while generation continues
- **THEN** their reading position is preserved and an explicit return-to-latest control is available

#### Scenario: Selection-free question
- **WHEN** a user sends a question without selecting PDF text
- **THEN** it is answered using bounded current-book evidence and appears in the current conversation

#### Scenario: Save completed answer
- **WHEN** a user saves an answer as a note
- **THEN** its Markdown and source references are preserved without changing chapter summaries or existing notes

### Requirement: Durable generation lifecycle
The system SHALL expose pending, streaming, completed, cancelled, and failed states, persist partial output, support cancellation and retry, and use stable request identities to prevent duplicate submissions. Only completed answers SHALL populate reusable explanation caches. Cancelling SHALL propagate to upstream work on a best-effort basis, without claiming that provider billing is reversed.

#### Scenario: Stream and complete
- **WHEN** a provider returns streamed deltas
- **THEN** the answer updates incrementally and the completed stored text equals the displayed text

#### Scenario: Cancel and retry
- **WHEN** a user stops generation and then retries
- **THEN** partial output remains visibly cancelled, no partial cache entry is created, and retry creates a linked attempt rather than silently overwriting the cancelled answer

#### Scenario: Duplicate or interrupted request
- **WHEN** the same request is submitted twice or the service restarts during generation
- **THEN** duplicates do not invoke additional model work and interrupted work becomes an explicit recoverable terminal state rather than remaining permanently pending

#### Scenario: Provider without streaming
- **WHEN** the provider explicitly rejects streaming as unsupported before returning output
- **THEN** the system supports a non-streaming completion with a visible pending state and does not fabricate streamed tokens

### Requirement: Explicit history association
The system SHALL separate complete stored history from model context. In default smart mode, standalone questions and template actions SHALL carry no prior conversation messages; an explicit follow-up SHALL include at most its referenced completed question-answer round. Cached-answer viewing SHALL NOT silently establish follow-up context.

#### Scenario: Independent question
- **WHEN** many messages exist and a new independent question is sent
- **THEN** none of those messages is added to its model request

#### Scenario: Follow a specific answer
- **WHEN** the user activates follow-up on an older completed answer
- **THEN** the composer identifies that answer and the request includes its associated round, not unrelated newer history

#### Scenario: Cancel follow-up
- **WHEN** the user removes the follow-up association
- **THEN** the next standalone request does not inherit that answer's history

### Requirement: Configurable bounded history
The system SHALL persist a history policy of smart, none, or recent-one, a maximum of zero to two history rounds, and a default history budget of approximately 1000 tokens with a supported upper limit of 1500 tokens. Smart mode SHALL be the default, zero rounds SHALL disable history, and the server SHALL enforce validated limits. At most two explicitly referenced rounds SHALL be usable for comparison. History SHALL NOT cross conversations; template actions SHALL remain history-free under every policy.

#### Scenario: Policy survives reload
- **WHEN** the user changes history preferences and reloads
- **THEN** the same preferences apply and effective limits are visible before sending

#### Scenario: Oversized or non-completed history
- **WHEN** associated history exceeds its budget or includes failed, cancelled, or streaming output
- **THEN** only bounded completed context is eligible, omissions are disclosed, and invalid states are excluded

#### Scenario: Reject invalid configuration
- **WHEN** a client supplies negative budgets, more than two rounds, or a budget above the supported ceiling
- **THEN** the server rejects the invalid values rather than trusting the client
