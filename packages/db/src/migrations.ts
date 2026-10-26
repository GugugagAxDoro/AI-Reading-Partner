import type { Database } from './database';

type SqlStatement = string;

const schemaV1: readonly SqlStatement[] = [
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    hash TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    title TEXT NOT NULL,
    author TEXT,
    page_count INTEGER NOT NULL,
    cover_path TEXT,
    source_path TEXT NOT NULL,
    text_layer TEXT NOT NULL DEFAULT 'unknown',
    processing_status TEXT NOT NULL DEFAULT 'pending',
    processing_stage TEXT NOT NULL DEFAULT 'received',
    processing_error TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    diagnostics_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS project_documents (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL REFERENCES documents(id),
    added_at TEXT NOT NULL,
    PRIMARY KEY (project_id, document_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_project_documents_project ON project_documents(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_project_documents_document ON project_documents(document_id)`,

  `CREATE TABLE IF NOT EXISTS pages (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL,
    text TEXT NOT NULL,
    char_count INTEGER NOT NULL,
    has_text INTEGER NOT NULL,
    diagnostics_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE(document_id, page_number)
  )`,

  `CREATE TABLE IF NOT EXISTS sections (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES sections(id) ON DELETE CASCADE,
    level INTEGER NOT NULL,
    ordinal INTEGER NOT NULL,
    title TEXT NOT NULL,
    start_page INTEGER NOT NULL,
    end_page INTEGER NOT NULL,
    start_offset INTEGER,
    end_offset INTEGER,
    source TEXT NOT NULL DEFAULT 'native_outline',
    UNIQUE(document_id, ordinal)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sections_document ON sections(document_id)`,

  `CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    section_id TEXT REFERENCES sections(id) ON DELETE SET NULL,
    page_number INTEGER NOT NULL,
    ordinal INTEGER NOT NULL,
    text TEXT NOT NULL,
    normalized_text TEXT NOT NULL,
    token_estimate INTEGER NOT NULL,
    char_start INTEGER,
    char_end INTEGER,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE(document_id, ordinal)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chunks_document_page ON chunks(document_id, page_number)`,

  `CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    chunk_id UNINDEXED,
    document_id UNINDEXED,
    section_id UNINDEXED,
    page_number UNINDEXED,
    text,
    normalized_text,
    tokenize = 'unicode61'
  )`,

  `CREATE TABLE IF NOT EXISTS summaries (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    section_id TEXT REFERENCES sections(id) ON DELETE CASCADE,
    scope TEXT NOT NULL,
    target_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    markdown TEXT,
    structure_json TEXT,
    prompt_version TEXT,
    model_id TEXT,
    provider_id TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, scope, target_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_summaries_document ON summaries(document_id)`,

  `CREATE TABLE IF NOT EXISTS term_cache (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    normalized_term TEXT NOT NULL,
    display_term TEXT NOT NULL,
    explanation TEXT NOT NULL,
    sources_json TEXT NOT NULL DEFAULT '[]',
    prompt_version TEXT,
    model_id TEXT,
    provider_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, normalized_term)
  )`,

  `CREATE TABLE IF NOT EXISTS content_cache (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL,
    page_number INTEGER NOT NULL,
    action TEXT NOT NULL,
    instruction_hash TEXT NOT NULL,
    normalized_text TEXT NOT NULL,
    selection_hash TEXT NOT NULL,
    answer TEXT NOT NULL,
    sources_json TEXT NOT NULL DEFAULT '[]',
    prompt_version TEXT,
    model_id TEXT,
    provider_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, document_id, page_number, action, instruction_hash, selection_hash)
  )`,

  `CREATE TABLE IF NOT EXISTS web_cache (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    query_hash TEXT NOT NULL,
    title TEXT,
    content TEXT,
    summary TEXT,
    status TEXT NOT NULL DEFAULT 'ready',
    source_metadata_json TEXT NOT NULL DEFAULT '{}',
    fetched_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    UNIQUE(project_id, url, query_hash)
  )`,

  `CREATE TABLE IF NOT EXISTS annotations (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL,
    page_number INTEGER NOT NULL,
    normalized_text TEXT NOT NULL,
    selection_hash TEXT NOT NULL,
    term_cache_id TEXT REFERENCES term_cache(id) ON DELETE SET NULL,
    kind TEXT NOT NULL DEFAULT 'term',
    color TEXT NOT NULL DEFAULT '#fde68a',
    anchor_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_annotations_document ON annotations(document_id, page_number)`,

  `CREATE TABLE IF NOT EXISTS reading_progress (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    current_page INTEGER NOT NULL DEFAULT 1,
    scroll_offset REAL NOT NULL DEFAULT 0,
    percent REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (project_id, document_id)
  )`,

  `CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    section_id TEXT REFERENCES sections(id) ON DELETE CASCADE,
    progress INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 1,
    stage TEXT,
    error TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL DEFAULT '{}',
    cancel_requested INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    task TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    rounds INTEGER NOT NULL DEFAULT 0,
    max_rounds INTEGER NOT NULL DEFAULT 8,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    budget_tokens INTEGER NOT NULL DEFAULT 120000,
    timeout_ms INTEGER NOT NULL DEFAULT 180000,
    result_json TEXT,
    error TEXT,
    started_at TEXT,
    finished_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS agent_steps (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    step_number INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    payload_json TEXT NOT NULL DEFAULT '{}',
    result_json TEXT,
    error TEXT,
    started_at TEXT,
    finished_at TEXT,
    UNIQUE(run_id, step_number)
  )`,

  `CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    markdown TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'user',
    status TEXT NOT NULL DEFAULT 'ready',
    file_path TEXT NOT NULL,
    created_by TEXT NOT NULL DEFAULT 'user',
    current_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project_id, updated_at DESC)`,

  `CREATE TABLE IF NOT EXISTS note_versions (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    title TEXT NOT NULL,
    markdown TEXT NOT NULL,
    change_kind TEXT NOT NULL DEFAULT 'edit',
    created_at TEXT NOT NULL,
    UNIQUE(note_id, version)
  )`,

  `CREATE TABLE IF NOT EXISTS note_links (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    target_status TEXT NOT NULL DEFAULT 'ready',
    link_text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(note_id, target_type, target_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_note_links_note ON note_links(note_id)`,
];

export function migrate(database: Database): void {
  const currentVersion = Number(database.pragma('user_version', { simple: true }));
  const latestVersion = 2;
  if (currentVersion === latestVersion) return;
  if (currentVersion > latestVersion) {
    throw new Error(`SQLite schema version ${currentVersion} is newer than supported version ${latestVersion}`);
  }

  database.transaction(() => {
    for (const statement of schemaV1) database.exec(statement);
    database.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
        document_hash TEXT NOT NULL,
        document_title TEXT NOT NULL,
        title TEXT NOT NULL,
        web_enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_conversations_scope ON conversations(project_id, document_hash, updated_at DESC);
      CREATE TABLE IF NOT EXISTS conversation_messages (
        ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('user','assistant')),
        action TEXT NOT NULL,
        markdown TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK(status IN ('pending','streaming','completed','cancelled','failed')),
        request_id TEXT,
        reply_to TEXT REFERENCES conversation_messages(id),
        retry_of TEXT REFERENCES conversation_messages(id),
        quote_json TEXT,
        parents_json TEXT NOT NULL DEFAULT '[]',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        sequence INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(conversation_id, request_id)
      );
      CREATE INDEX IF NOT EXISTS idx_messages_cursor ON conversation_messages(conversation_id, ordinal DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_active ON conversation_messages(conversation_id)
        WHERE role = 'assistant' AND status IN ('pending','streaming');
      CREATE TABLE IF NOT EXISTS reader_preferences (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      );
    `);
    database.pragma(`user_version = ${latestVersion}`);
  })();
}
