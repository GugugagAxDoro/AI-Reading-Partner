## Context

The repository currently contains only OpenSpec planning scaffolding. The product must be local-first and open-source friendly: users bring their own PDFs, run the app locally, configure their own OpenAI-compatible APIs and SearXNG instance, and retain their notes and caches on disk. The initial sample target includes Chinese text and native PDF bookmarks, so the design must handle CJK retrieval and hierarchical navigation without assuming English tokenization.

## Goals / Non-Goals

**Goals:**

- Use one TypeScript codebase for the frontend, backend, processing pipeline, and agent runtime.
- Keep document parsing and derived artifacts global, while making caches, notes, agent history, and progress project-scoped.
- Process PDFs asynchronously so large books do not block the management UI or reader.
- Build a retrieval layer that works without a mandatory embedding service and handles Chinese text.
- Give the agent explicit tools, bounded execution, source attribution, and deterministic permissions.
- Separate user-visible artifacts from agent-only intermediates and renewable caches.

**Non-Goals:**

- No cloud account system, multi-user synchronization, or hosted deployment model.
- No scanned-PDF OCR, translation, image generation, backlink graph UI, project export, Tavily, or MCP tools.
- No automatic distribution of book source content to a search provider.
- No assumption that the user's OpenAI-compatible endpoint supports tool calling, JSON mode, embeddings, or a particular prompt-caching API.

## Decisions

### Application architecture

Use a TypeScript monorepo:

```text
apps/web      React + Vite frontend
apps/server   Fastify local API and background worker
packages/core PDF processing, chunking, retrieval, context building
packages/ai   OpenAI-compatible clients, model routing, prompts
packages/db   SQLite schema, migrations, repositories
```

The web client and local server run on the same machine. The server binds to localhost by default. React Query manages server-state caching; PDF.js renders documents in the browser; Fastify exposes local APIs and server-sent events for long-running task progress.

Rationale: React + PDF.js is the strongest browser-side PDF reading baseline. Fastify is lighter than a full framework and fits a local API. SQLite avoids requiring a separate database service.

### Local storage layout

The data root defaults to the platform application-data directory and can be overridden by `AI_READING_PARTNER_DATA_DIR`:

```text
{dataRoot}/
├── app.db
├── config/
│   ├── providers.example.toml
│   └── providers.toml
├── documents/
│   └── {documentHash}/
│       ├── source.pdf
│       ├── cover.png
│       ├── extracted/pages.jsonl
│       ├── extracted/chunks.jsonl
│       └── processing/
├── projects/{projectId}/
│   ├── artifacts/
│   │   ├── notes/{noteId}.md
│   │   ├── mindmaps/{noteId}.html
│   │   ├── exports/
│   │   └── images/{noteId}/
│   ├── agent/runs/{runId}/
│   │   ├── plan.json
│   │   ├── steps.jsonl
│   │   ├── observations/
│   │   ├── drafts/
│   │   └── web-sources/
│   └── cache/{terms,content,web,summaries}/
└── tmp/
```

`documents/` is keyed by SHA-256 document hash so one physical PDF can belong to multiple projects. `artifacts/` contains user-visible products. `agent/` contains reproducible intermediates. `cache/` is disposable or renewable.

### SQLite data model

Use SQLite through Drizzle ORM. Core tables:

- `projects`, `documents`, and `project_documents`
- `pages`, `sections`, and `chunks`
- `summaries` with scope, target, markdown, JSON structure, prompt version, and status
- `term_cache`, `content_cache`, and `web_cache`
- `notes`, `note_versions`, and `note_links`
- `annotations` for selection/term markers
- `reading_progress` scoped by project and document
- `jobs` for persistent background processing state
- `agent_runs` and `agent_steps` for concise UI state plus links to run files

SQLite FTS5 indexes chunk text. To support Chinese without requiring an external tokenizer, the indexer emits character bigrams for CJK spans and normal word tokens for Latin spans. Search scoring combines FTS BM25 with current-document, current-section, and current-page boosts. An embedding adapter interface is retained, but the MVP does not require an embedding model.

### PDF pipeline

Import performs these persistent stages:

```text
receive PDF
  → SHA-256 + source storage
  → metadata and cover extraction
  → text extraction and text-layer classification
  → native outline extraction
  → structural outline generation when needed
  → section and chunk construction
  → FTS index build
  → macro summary scheduling
```

Text-layer classification uses page text length, the proportion of text-bearing pages, and image coverage. Exact thresholds live in configuration and are validated against mixed documents containing covers, part-divider pages, figures, and dense Chinese body text. The reader remains usable while outline or summary work is pending.

Native PDF outlines are preferred. If they are absent or ambiguous, the server extracts font-size, page-position, and heading-pattern candidates, then uses the strong model only when configured. Deterministic structural output is stored before model post-processing so catalog construction can succeed without AI.

### Test fixture strategy

Automated tests use small, locally generated CJK fixtures instead of user-supplied books. The MVP defines three fixture profiles:

| Fixture | Profile | Purpose |
|---|---|---|
| `cjk-basic.pdf` | 3-5 pages of continuous Simplified Chinese paragraphs with repeated terms | Text extraction, chunking, selection, term cache, and CJK retrieval |
| `cjk-outline.pdf` | 4-6 pages with native outline/bookmarks and a small section hierarchy | Outline navigation, section summaries, and page targeting |
| `cjk-mixed.pdf` | 4-6 pages with mixed Chinese/Latin text plus image-only or low-text pages | Mixed text-layer classification, low-text warnings, and limited-context behavior |

A fixture manifest records page counts, expected text snippets, expected outline entries, and expected classification. The fixtures and manifest are generated deterministically by the test tooling. User-provided books, including the large sample document, are not committed as fixtures and are not used in automated tests.

### Summary and context strategy

Summaries are versioned artifacts with a stable base summary and separately stored Dynamic Notes:

- Book macro summary: generated in the background after structure is available.
- Chapter summary: generated lazily on first entry to a chapter, using map-reduce over chapter chunks.
- Project summary: generated on demand from member-book summaries and selected project evidence.
- Dynamic Notes: standalone user-facing notes; never merged into base summaries.

Context Builder selects content by request type:

| Request type | Context profile |
|---|---|
| Selected passage | selected text, adjacent chunks, section title, relevant summary, limited term cache |
| Book question | book summary, section summaries, top retrieved chunks |
| Project question | project summary, member-book summaries, cross-document retrieved chunks |
| Agent task | explicit task, working plan, selected tool observations, bounded evidence set |

Every model input records a context hash, prompt version, model ID, provider ID, and token estimate. Token budgets are configured by request class and enforced before calls. If budget is exceeded, nearby content is trimmed before summaries; summaries are trimmed before retrieved chunks.

### Cache design

Cache keys include semantic identity and generation metadata:

| Cache | Scope | Key basis | Lifetime |
|---|---|---|---|
| Term explanation | project | normalized term | manual invalidation |
| Passage explanation | document | document + page + normalized text + action/instruction hash | manual invalidation |
| Summary | document/project/section | target + content hash + prompt version | regenerate on demand |
| Web page | project | normalized URL + fetch parameters | 180 days |
| Agent step | agent run | step sequence | retained with run |

Term normalization removes punctuation and whitespace, lowercases Latin text, and preserves CJK characters. It does not attempt full multilingual lemmatization in this phase. Cached values are model-generation-aware but can still be reused across compatible prompts when explicitly marked reusable.

### Model routing

Model access is configured through two user-facing tiers, lightweight and strong:

```toml
[providers.main]
type = "openai-compatible"
base_url = "..."
api_key = "..."

[models.light]
provider = "main"
model = "..."
context_window = 128000
supports_tool_calling = false

[models.strong]
provider = "main"
model = "..."
context_window = 200000
supports_tool_calling = true
```

The server owns model calls. It never exposes provider secrets to the browser, logs, timeline payloads, or SQLite. The config file is read from `{dataRoot}/config/providers.toml`; only an example file is committed to the repository.

Internal routing maps task complexity to a tier:

- Lightweight: query generation, chunk summaries, evidence judging, simple term explanation, simple passage interpretation.
- Strong: final synthesis, complex Q&A, book/project summaries, note writing, mind-map outline generation, agent planning.

A `fast | balanced | quality` mode shifts the routing threshold. A tool-calling capability flag selects native OpenAI tool calls or the JSON plan protocol. If a model call fails due to capability mismatch, the runtime retries through the fallback protocol only when safe and records the fallback in the agent timeline.

### Retrieval and agent runtime

The agent has a small explicit tool registry:

```text
search_current_document
search_project
search_web
fetch_web_page
read_document_chunks
read_section
read_summary
list_sections
create_note
append_note
rewrite_note
delete_note
read_note
generate_mindmap
read_cache
save_cache
finish
```

Fast selected-text actions bypass the agent unless they need multi-step evidence. Agent execution is bounded by a default of eight rounds, a configurable token budget, a wall-clock timeout, and a maximum output size. Each step is persisted in SQLite and appended to the run's JSONL files.

The evidence judge receives the user intent and top retrieved chunks plus compact metadata. It returns relevance, coverage, missing concepts, and whether project/web retrieval is justified. Retrieval follows current document → project → web. SearXNG receives only generated queries and search settings. Page fetching is constrained by protocol, redirect limit, timeout, content size, content type, and private-network address blocking.

### Notes, links, and mind maps

Markdown is the canonical user-visible note format. SQLite stores metadata, link edges, and historical versions; the current Markdown remains directly readable under `artifacts/notes/`.

Links use stable IDs, not filenames:

```markdown
[[term:term_123]]
[[note:note_456]]
[[doc:doc_789]]
[[section:sec_012]]
[[web:web_345]]
```

The renderer resolves these to titles at display time. Clicking navigates to the associated artifact or reader location. Links are retained with `missing_source` when targets disappear; reimporting the same document hash can restore compatible references.

Mind maps are derived from Markdown heading/list structure. The in-app viewer uses Markmap libraries. Exported HTML is generated as an offline-readable file with bundled renderer assets rather than relying on a public CDN.

### Background jobs and failure handling

Jobs are rows in SQLite with status, progress, stage, retry count, and error details. An in-process worker is sufficient for the MVP and keeps deployment to one local process. Import stages are idempotent and keyed by document hash. A failed book remains visible and retryable. Model-dependent stages remain pending when models are unconfigured.

### Security and privacy

- Secrets exist only in the provider configuration file and are redacted in every API and log surface.
- Uploads are validated by PDF signature, file-size limit, and document hash.
- File access paths are constructed from server-generated IDs and never trust client-supplied traversal paths.
- Web fetching blocks private and loopback addresses, limits redirects and response size, and accepts only safe content types.
- External model calls are limited to selected context. Search calls contain generated queries only.
- The local server binds to loopback by default and does not expose a public management endpoint.

## Risks / Trade-offs

- [PDF extraction quality varies by producer] → Store per-page diagnostics, classify mixed documents, and show limited-AI-context markers instead of pretending every page has usable text.
- [SQLite FTS is weaker than vector semantic search] → Use CJK-aware bigrams, section/page boosts, and an embedding adapter interface; semantic retrieval can be added later without changing the agent contract.
- [PDF.js selection anchors can be unstable across viewers] → Persist page, normalized text, offsets when available, and a text hash; use anchor data for recovery but make text hash the cache key.
- [Agent loops can consume excessive tokens] → Enforce default eight rounds, request and lifetime token budgets, timeouts, and explicit finish behavior.
- [A local Markdown file can be edited outside the app] → Treat the app as the sync boundary for the MVP; external edits are loaded when explicitly requested, while in-app history remains authoritative for undo/restore.
- [SearXNG instances differ in API settings] → Validate JSON output at configuration check time and provide actionable setup guidance.
- [Bundling Markmap assets increases export size] → Generate mind-map HTML on demand and keep renderer assets local rather than fetching a public CDN.
