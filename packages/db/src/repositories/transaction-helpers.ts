import type { Database } from '../database';

export interface DeleteDocumentResult {
  removed: boolean;
  missingReferences: number;
}

export function deleteProjectCascade(database: Database, projectId: string): boolean {
  return database
    .prepare('DELETE FROM projects WHERE id = ?')
    .run(projectId).changes > 0;
}

export function removeDocumentFromProject(database: Database, projectId: string, documentId: string): boolean {
  return database
    .prepare('DELETE FROM project_documents WHERE project_id = ? AND document_id = ?')
    .run(projectId, documentId).changes > 0;
}

export function markDocumentReferencesMissing(database: Database, documentId: string): void {
  database
    .prepare(`UPDATE note_links SET target_status = 'missing_source' WHERE target_type = 'doc' AND target_id = ?`)
    .run(documentId);
  database
    .prepare(`UPDATE note_links SET target_status = 'missing_source' WHERE target_type = 'section' AND target_id IN (
      SELECT id FROM sections WHERE document_id = ?
    )`)
    .run(documentId);
}

export function permanentlyDeleteDocument(database: Database, documentId: string): DeleteDocumentResult {
  const exists = database.prepare('SELECT id FROM documents WHERE id = ?').get(documentId);
  if (!exists) return { removed: false, missingReferences: 0 };

  return database.transaction(() => {
    const missingReferences = database
      .prepare('UPDATE note_links SET target_status = ? WHERE target_type IN (?, ?) AND target_id = ?')
      .run('missing_source', 'doc', 'section', documentId).changes;

    database
      .prepare(`DELETE FROM content_cache WHERE document_id = ? AND project_id NOT IN (
        SELECT project_id FROM project_documents WHERE document_id = ?
      )`)
      .run(documentId, documentId);
    database.prepare('DELETE FROM annotations WHERE document_id = ?').run(documentId);
    database.prepare('DELETE FROM reading_progress WHERE document_id = ?').run(documentId);
    database.prepare('DELETE FROM project_documents WHERE document_id = ?').run(documentId);
    database.prepare('DELETE FROM documents WHERE id = ?').run(documentId);

    return { removed: true, missingReferences };
  })();
}

export function prepareDocumentSourceForReimport(
  database: Database,
  documentId: string,
  update: { sourcePath?: string; filename?: string; sizeBytes?: number },
): void {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (update.sourcePath) {
    fields.push('source_path = ?');
    values.push(update.sourcePath);
  }
  if (update.filename) {
    fields.push('filename = ?');
    values.push(update.filename);
  }
  if (typeof update.sizeBytes === 'number') {
    fields.push('size_bytes = ?');
    values.push(update.sizeBytes);
  }
  if (fields.length > 0) {
    fields.push('processing_status = ?', 'processing_stage = ?', 'processing_error = ?', 'updated_at = ?');
    values.push('pending', 'received', null, new Date().toISOString(), documentId);
    database.prepare(`UPDATE documents SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }
}
