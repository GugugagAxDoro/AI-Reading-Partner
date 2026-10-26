## 1. Project Foundation

- [x] 1.1 Create the TypeScript monorepo structure for `apps/web`, `apps/server`, `packages/core`, `packages/ai`, and `packages/db`, including build, lint, test, and development scripts.
- [x] 1.2 Configure a React + Vite frontend, a localhost-only Fastify server, shared TypeScript config, and local development proxying.
- [x] 1.3 Implement the application data-root resolver, platform-appropriate default path, environment override, and first-run directory bootstrap.
- [x] 1.4 Add SQLite, migration tooling, configuration loading, structured logging, and server error handling.

## 2. Persistence Layer

- [x] 2.1 Create migrations and repositories for projects, documents, and project-document relationships.
- [x] 2.2 Create migrations and repositories for pages, sections, chunks, document hashes, and processing metadata.
- [x] 2.3 Create migrations and repositories for book, chapter, and project summaries plus term, content, and web caches.
- [x] 2.4 Create migrations and repositories for annotations, reading progress, persistent jobs, agent runs, and agent steps.
- [x] 2.5 Create migrations and repositories for notes, note versions, and stable note links.
- [x] 2.6 Add transactional helpers for import stages, deletion cascades, and missing-source updates.

## 3. Provider and Model Configuration

- [x] 3.1 Define and load `config/providers.toml`, including OpenAI-compatible providers, lightweight/strong model tiers, quality mode, and SearXNG settings.
- [x] 3.2 Implement provider status validation, redacted status responses, invalid-config errors, and hot reload or controlled reload behavior.
- [x] 3.3 Implement an OpenAI-compatible model client with streaming, token accounting, retry handling, timeout enforcement, and provider-specific error normalization.
- [x] 3.4 Implement lightweight/strong routing for the task profiles defined in design.md.
- [x] 3.5 Implement native tool-calling support and the structured JSON plan protocol fallback, including capability flags and fallback logging.

## 4. PDF Import and Processing

- [x] 4.1 Implement PDF upload validation, file-size limits, SHA-256 calculation, source storage, and duplicate-document reuse.
- [x] 4.2 Implement metadata extraction and cover-page image generation.
- [x] 4.3 Implement page text extraction, page text serialization, and text/mixed/scanned classification with diagnostics.
- [x] 4.4 Implement native PDF outline extraction and normalize outline destinations into the section model.
- [x] 4.5 Implement deterministic outline candidate detection and optional model-assisted outline refinement when a strong model is configured.
- [x] 4.6 Implement section-aware chunking with token estimates, CJK-aware normalization, and chunk provenance metadata.
- [x] 4.7 Build the SQLite FTS index with CJK character bigrams and Latin token normalization.
- [x] 4.8 Implement the persistent import job pipeline with stage progress, retry, cancellation-safe idempotency, and failure reporting.

## 5. Project Library Management

- [x] 5.1 Implement project CRUD APIs and project list/detail serialization.
- [x] 5.2 Implement book import, remove-from-project, retry-processing, and permanent-delete APIs.
- [x] 5.3 Build the management UI for project creation, book cards, import status, processing timeline, and error/retry states.
- [x] 5.4 Display cover previews, metadata, text-layer status, last-read time, and reading progress on book cards.
- [x] 5.5 Implement deletion rules that preserve missing-source references and restore compatible references on same-hash reimport.

## 6. PDF Reading Workspace

- [x] 6.1 Implement reading routes and the responsive three-pane workspace layout.
- [x] 6.2 Integrate PDF.js continuous-scroll rendering with virtualized page management and document loading states.
- [x] 6.3 Implement previous/next page controls, direct page input, page indicators, and approximate scroll-position restoration.
- [x] 6.4 Implement selection capture and stable selection anchors with normalized text, page, offsets when available, and selection hash.
- [x] 6.5 Implement the left panel tabs for directory, summaries, and notes.
- [x] 6.6 Implement outline click navigation, low-text page indicators, and per-project reading progress saving.

## 7. Retrieval, Context, and Cache

- [x] 7.1 Implement current-document retrieval using FTS scoring, section/page boosts, and structured source citations.
- [x] 7.2 Implement project-wide retrieval with current-document preference and cross-document result attribution.
- [x] 7.3 Implement cache key generation, normalization, prompt/model metadata, cache lookup, and cache write repositories.
- [x] 7.4 Implement request-specific context profiles and token budgets for selected passage, book, project, and agent requests.
- [x] 7.5 Implement deterministic context trimming that preserves selected text, source references, and the highest-relevance evidence.

## 8. AI Reading Assistance

- [x] 8.1 Create versioned prompt templates for vocabulary explanation, passage interpretation, custom questions, and summaries.
- [x] 8.2 Implement selected-text API actions with Simplified Chinese defaults, user language overrides, and source citations.
- [x] 8.3 Wire term and passage caches into AI actions and render repeat-term and cached-passage markers in the reader.
- [x] 8.4 Implement background book macro summary generation after import structure is ready.
- [x] 8.5 Implement lazy chapter summary generation when the user first enters a chapter, including pending/ready/failed states.
- [x] 8.6 Implement on-demand project summary generation from member-book summaries and project evidence.
- [x] 8.7 Implement standalone Dynamic Notes so AI-derived insights remain separate from base summaries.

## 9. Agent Runtime and Web Research

- [x] 9.1 Implement agent run creation, SQLite state, run files, execution limits, token budgets, timeout enforcement, and final-run records.
- [x] 9.2 Implement intent routing between direct AI actions and agent tasks.
- [x] 9.3 Implement the agent planner and tool-call loop for both native tool calling and JSON plan protocol.
- [x] 9.4 Implement the explicit tool registry, permission checks, argument validation, tool result normalization, and structured failures.
- [x] 9.5 Implement current-document and project search tools with current-document-first fallback ordering.
- [x] 9.6 Implement the SearXNG client, JSON API validation, query generation, result parsing, and search-result caching.
- [x] 9.7 Implement safe web page fetching with redirect, timeout, size, content-type, and private-network protections.
- [x] 9.8 Implement web page content extraction, summarization, source metadata, 180-day expiry, stale handling, and manual cache cleanup.
- [x] 9.9 Implement the evidence judge, retrieval expansion decisions, mixed-source citations, and explicit evidence-gap reporting.
- [x] 9.10 Implement the user-facing agent timeline and concise tool-step details while redacting secrets and oversized payloads.

## 10. Notes, Links, and Mind Maps

- [x] 10.1 Implement Markdown note CRUD, stable note IDs, metadata, version snapshots, history viewing, and version restore.
- [x] 10.2 Synchronize current Markdown files with note records under `projects/{projectId}/artifacts/notes/`.
- [x] 10.3 Implement stable link syntax for terms, notes, documents, sections, and web sources; parse links into the link graph.
- [x] 10.4 Implement rendered note navigation with click-to-jump and missing-source states.
- [x] 10.5 Implement agent note creation, automatic small appends, confirmation-required rewrites/deletes, and automatic stable-link insertion.
- [x] 10.6 Implement direct user note editing and conflict-safe version creation.
- [x] 10.7 Implement Markdown outline extraction and Markmap HTML mind-map generation.
- [x] 10.8 Implement in-app mind-map viewing, regeneration, offline HTML export, and artifact organization.

## 11. Experience Integration

- [x] 11.1 Connect PDF selection, AI actions, cache markers, notes, summaries, and directory navigation into one coherent reading flow.
- [x] 11.2 Connect management-page status, reader progress, job progress, summary status, and failure states.
- [x] 11.3 Connect agent research results to notes, mind maps, citations, and the reading workspace.
- [x] 11.4 Add empty, loading, unconfigured-provider, failed-job, missing-source, and no-search-endpoint states across the UI.

## 12. Testing and Verification


## 13. Documentation and Release Readiness

- [x] 13.1 Write README setup instructions for development mode, production-local mode, data directories, and first-run configuration.
- [x] 13.2 Document `providers.example.toml`, lightweight/strong model routing, quality modes, and OpenAI-compatible compatibility caveats.
- [x] 13.3 Document SearXNG deployment, JSON API requirements, privacy behavior, cache retention, and manual cleanup.
- [x] 13.4 Document local storage layout, backup guidance, note file behavior, agent run files, and deletion semantics.
- [x] 13.5 Add license, contribution, security, privacy, and known-limitations documentation.
- [x] 13.6 Run OpenSpec validation, full automated tests, lint, build, and a manual smoke test against one of the local CJK text-layer fixtures.
