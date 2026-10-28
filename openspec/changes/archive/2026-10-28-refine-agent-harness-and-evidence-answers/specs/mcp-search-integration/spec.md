## Purpose

Provide a controlled application-side MCP boundary for SearXNG search and selected web-page reading, independent of the model provider, while preserving privacy, cancellation, bounded execution, and safe local-only fallback.

## ADDED Requirements

### Requirement: Application-mediated MCP search
The system SHALL execute external search and selected-page reading through an application-owned MCP connection to a local stdio server backed by the configured SearXNG instance. Direct reading questions, shortcuts, and research tasks SHALL use the same boundary. Model providers SHALL NOT need native MCP support, and a failed MCP request SHALL NOT silently bypass the boundary through a direct HTTP search path.

#### Scenario: Search from a reading question
- **WHEN** an uncached reading question requires external evidence and web access is enabled
- **THEN** the application invokes the MCP search tool, records the invocation, and attaches bounded results with source identities

#### Scenario: Provider without native tools
- **WHEN** the configured model uses the supported structured-plan fallback
- **THEN** validated tool requests still execute through the same MCP boundary and enforce identical permissions

### Requirement: Bounded search and page results
The system SHALL validate tool arguments and returned results, bound result count and content size, and preserve source URL, title, retrieval time, and whether evidence is a search snippet or fetched page text. Full tool results SHALL remain outside the model context and only relevant excerpts SHALL enter model requests. A snippet SHALL NOT be represented as a verified full-page reading.

#### Scenario: Oversized search response
- **WHEN** a search returns more items or text than the allowed budget
- **THEN** only bounded structured results enter the model context and omitted content remains retrievable by reference

#### Scenario: Page cannot be read
- **WHEN** a useful result has an inaccessible body but an available search snippet
- **THEN** the snippet remains explicitly identified as snippet evidence and the application does not claim to have read the page

### Requirement: MCP lifecycle and error recovery
The system SHALL bound MCP startup, discovery, and tool execution by timeouts and the parent request deadline, reuse healthy connections, and close owned processes during application shutdown. Failure SHALL produce a typed unavailable or invalid-result outcome rather than hanging the reading task. A failed request SHALL NOT enter an unbounded reconnect or retry loop.

#### Scenario: Server startup failure
- **WHEN** the MCP server fails to start or discover required tools within its deadline
- **THEN** local reading remains usable and the request reports external-evidence unavailability without repeatedly restarting the server in that request

#### Scenario: Cancel pending tool
- **WHEN** the user cancels during a search or page read
- **THEN** cancellation reaches the MCP operation and downstream fetch on a best-effort basis, late results cannot resume generation, and the task remains cancelled

### Requirement: Network privacy and destination safety
The system SHALL send only generated search queries and necessary settings to SearXNG, not raw passages, whole books, notes, history, or model credentials. External page destinations and redirects SHALL be validated to reject unsafe schemes, local files, loopback, private, link-local, and metadata destinations, including DNS-based redirection. The explicitly configured SearXNG endpoint SHALL be a separate trusted-backend exception, not an exemption for arbitrary result URLs. External text SHALL remain untrusted data and SHALL NOT grant tool permissions.

#### Scenario: Local SearXNG with unsafe search hit
- **WHEN** SearXNG is configured on loopback and returns a result pointing to a private service
- **THEN** the configured search backend is reachable but reading that result is blocked

#### Scenario: Prompt injection in a page
- **WHEN** a page instructs the agent to disclose keys, upload a document, or rewrite a note
- **THEN** those instructions do not change permissions or trigger the requested action

#### Scenario: Conversation web disabled
- **WHEN** web access is disabled for a conversation
- **THEN** no external search or page read occurs, including tool calls proposed by the model and background prefetch for that answer
