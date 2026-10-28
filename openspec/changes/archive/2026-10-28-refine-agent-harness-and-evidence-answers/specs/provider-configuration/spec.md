## MODIFIED Requirements

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

## ADDED Requirements

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
