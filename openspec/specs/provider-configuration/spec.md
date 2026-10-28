# provider-configuration Specification

## Purpose

Lets users configure OpenAI-compatible lightweight and strong models plus SearXNG through a local file while preserving credentials outside the database.
## Requirements
### Requirement: Model provider configuration
The system SHALL support OpenAI-compatible model APIs configured in the user's local `config/providers.toml`, including base URL, API key, model name, context window, and tool-calling capability.

#### Scenario: Valid provider
- **WHEN** the user provides a reachable OpenAI-compatible endpoint and valid credentials
- **THEN** the app reports the model configuration as active

#### Scenario: Missing configuration
- **WHEN** required model configuration is absent or invalid
- **THEN** AI features are disabled with actionable setup guidance and reading/import features remain available

### Requirement: Lightweight and strong model tiers
The system SHALL expose two model tiers, lightweight and strong, and route tasks by complexity and quality mode rather than requiring task-specific model roles in the configuration.

#### Scenario: Lightweight routing
- **WHEN** the system performs query generation, chunk summarization, evidence judging, or a simple selected-text explanation
- **THEN** it uses the configured lightweight model unless routing rules require fallback

#### Scenario: Strong routing
- **WHEN** the system performs complex synthesis, chapter/book/project summaries, Markdown writing, mind-map structure generation, or agent planning
- **THEN** it uses the configured strong model

#### Scenario: Quality mode
- **WHEN** the user selects fast, balanced, or quality mode
- **THEN** the routing threshold between lightweight and strong models changes accordingly

### Requirement: Tool-calling compatibility
The system SHALL support models that use native tool calling and models that do not by providing a structured JSON plan protocol fallback.

#### Scenario: Native tool calling
- **WHEN** the strong model declares tool-calling support
- **THEN** agent tool calls use the native protocol

#### Scenario: JSON protocol fallback
- **WHEN** the model does not support tool calling
- **THEN** agent planning uses structured JSON responses and explicit tool execution

### Requirement: SearXNG configuration
The system SHALL use one user-configured SearXNG endpoint in the application data directory's `config/providers.toml`, accessed by the application-owned local MCP search server. There SHALL be no hardcoded public fallback endpoint. Existing valid SearXNG endpoint settings SHALL remain compatible without requiring users to move model credentials or configure a separate provider account. Web access enabled SHALL default to on-demand retrieval rather than mandatory search.

#### Scenario: Valid search endpoint
- **WHEN** the configured SearXNG instance supports JSON results and the local MCP server is healthy
- **THEN** search is available to permitted requests when evidence requires it

#### Scenario: Invalid search endpoint
- **WHEN** the endpoint is absent, unreachable, or has JSON output disabled
- **THEN** local reading and project search continue, external retrieval exposes a configuration or availability status, and no public endpoint is substituted

#### Scenario: Existing configuration
- **WHEN** an existing installation upgrades with valid model and SearXNG settings
- **THEN** it can use the application-owned MCP bridge without supplying model-provider MCP credentials

### Requirement: Credential isolation
The system SHALL load API keys and secrets from the user-managed configuration file and SHALL NOT store plaintext API keys in the SQLite database.

#### Scenario: Configuration read
- **WHEN** the application starts or reloads provider settings
- **THEN** credentials are read from the configuration file and are not persisted to the database

#### Scenario: UI display
- **WHEN** provider settings are displayed
- **THEN** secrets are redacted and are not exposed through APIs, logs, or agent timelines

### Requirement: Local MCP search configuration isolation
The system SHALL start only the packaged, application-owned stdio search server in this phase and allow user-managed search settings and bounded operational limits through the local configuration file. Arbitrary executable commands and remote MCP endpoints SHALL NOT be accepted as silent replacements. The search process SHALL receive only the configuration it needs, not model API keys or unrelated secrets. Example configuration SHALL contain placeholders only, and live configuration SHALL remain excluded from version control and redacted from status APIs, logs, and run records.

#### Scenario: Minimal child configuration
- **WHEN** the MCP search server starts
- **THEN** it receives necessary search settings without inheriting model credential values from the parsed provider configuration or application-supplied child environment

#### Scenario: Invalid limits
- **WHEN** configuration specifies unsupported transport, arbitrary executable, or invalid execution limits
- **THEN** validation reports an actionable error without launching that configuration or disabling unrelated reading features

#### Scenario: Secrets in diagnostics
- **WHEN** search health or startup errors are displayed or recorded
- **THEN** no API key, authorization header, endpoint password, or secret query parameter is exposed
