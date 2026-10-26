## Why

Readers need a local-first research workspace that turns PDFs into navigable, explainable, and queryable knowledge without repeatedly sending the same content to expensive model APIs. The current repository has no application implementation, so this change establishes the first usable MVP: PDF reading, project-based AI assistance, local caching, retrieval, summaries, notes, mind maps, and a constrained agent.

## What Changes

- Introduce a local-first web application for managing projects, importing PDF books, tracking reading progress, and opening a three-pane reading workspace.
- Add a PDF reader with continuous scrolling, page navigation, text selection, AI-generated outline navigation, and detected missing-source warnings for low-text pages.
- Add AI reading actions for selected text, including vocabulary explanation, content interpretation, and custom questions; translation is explicitly out of scope for this phase.
- Add book, chapter, project, and dynamic-note summaries with background generation and cache-aware context construction.
- Add a project-scoped cache for terminology, selected-content explanations, summaries, and web research results.
- Add a constrained agent that searches the current document first, then the project, then the user-configured SearXNG instance, and can create and edit Markdown notes.
- Add Markdown note management with versioned edits, automatic bidirectional-link insertion, click-to-jump rendering, and Markmap HTML mind map generation.
- Add configuration for OpenAI-compatible lightweight and strong models plus one active SearXNG provider; API keys are stored in a user-managed config file, not in SQLite.
- Explicitly defer scanned-PDF OCR, translation, Tavily or other search providers, MCP tool integration, image generation, backlink panels, and whole-project export.

## Capabilities

### New Capabilities

- `project-library-management`: Project and book library management, PDF import and deletion, cover/metadata display, processing status, reading progress, and project-scoped cleanup.
- `pdf-reader-workspace`: Three-pane reading workspace, PDF.js rendering, navigation, selection capture, outline navigation, and text-layer status handling.
- `ai-reading-assistance`: Selected-text AI actions, summaries, background chapter processing, cache reuse, local context assembly, and Dynamic Notes.
- `research-agent`: Constrained agent planning, tool execution, current-document/project/web retrieval fallback, evidence judging, Markdown notes, mind maps, agent timeline, and execution limits.
- `provider-configuration`: User-managed OpenAI-compatible lightweight/strong model configuration, SearXNG configuration, model routing, and secure handling of credentials outside the database.

### Modified Capabilities

None. This is the initial application capability set.

## Impact

- Creates the first application frontend, local API service, SQLite schema, PDF processing pipeline, retrieval index, cache repositories, and background job system.
- Adds frontend dependencies for React, PDF.js, and Markmap-based mind map rendering, plus backend dependencies for PDF text extraction, SQLite, configuration loading, background jobs, and SearXNG HTTP integration.
- Adds user-facing behavior for project management, reading, AI interactions, notes, mind maps, and agent timelines.
- Adds local storage under the application data directory with clear separation between shared documents, project artifacts, agent intermediates, caches, and temporary files.
- Introduces privacy-sensitive external calls only through user-configured model APIs and SearXNG; the system must not send whole documents to web search.
