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
The system SHALL use one SearXNG endpoint configured in `config/providers.toml`, and SHALL NOT include a hardcoded public SearXNG endpoint.

#### Scenario: Valid search endpoint
- **WHEN** the user configures a SearXNG instance with JSON output enabled
- **THEN** the web-search feature is available for agent use

#### Scenario: Invalid search endpoint
- **WHEN** the endpoint is absent, unreachable, or JSON output is disabled
- **THEN** web search is disabled, local document and project search continue, and the UI explains the configuration issue

### Requirement: Credential isolation
The system SHALL load API keys and secrets from the user-managed configuration file and SHALL NOT store plaintext API keys in the SQLite database.

#### Scenario: Configuration read
- **WHEN** the application starts or reloads provider settings
- **THEN** credentials are read from the configuration file and are not persisted to the database

#### Scenario: UI display
- **WHEN** provider settings are displayed
- **THEN** secrets are redacted and are not exposed through APIs, logs, or agent timelines
