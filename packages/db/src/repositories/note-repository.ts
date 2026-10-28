import { randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from '../database';

export interface NoteRecord {
  id: string;
  project_id: string;
  title: string;
  markdown: string;
  source: 'user' | 'agent';
  status: 'ready' | 'missing_source';
  file_path: string;
  created_by: string;
  current_version: number;
  created_at: string;
  updated_at: string;
}

export interface NoteLinkRecord {
  id: string;
  project_id: string;
  note_id: string;
  target_type: 'term' | 'note' | 'doc' | 'section' | 'web';
  target_id: string;
  target_status: 'ready' | 'missing_source';
  link_text: string;
  created_at: string;
}

export interface NoteVersionRecord {
  id: string;
  note_id: string;
  version: number;
  title: string;
  markdown: string;
  change_kind: 'create' | 'append' | 'edit' | 'rewrite' | 'restore';
  created_at: string;
}

export class NoteRepository {
  constructor(
    private readonly database: Database,
    private readonly dataRoot: string,
  ) {}

  create(input: {
    projectId: string;
    title: string;
    markdown: string;
    source?: NoteRecord['source'];
    createdBy?: string;
  }): NoteRecord {
    const now = new Date().toISOString();
    const id = randomUUID();
    const noteDirectory = join(this.dataRoot, 'projects', input.projectId, 'artifacts', 'notes');
    mkdirSync(noteDirectory, { recursive: true });
    const filePath = join(noteDirectory, `${id}.md`);
    writeFileSync(filePath, input.markdown, 'utf8');

    this.database
      .prepare(
        `INSERT INTO notes (
           id, project_id, title, markdown, source, status, file_path, created_by,
           current_version, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'ready', ?, ?, 1, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.title,
        input.markdown,
        input.source ?? 'user',
        filePath,
        input.createdBy ?? input.source ?? 'user',
        now,
        now,
      );
    this.database
      .prepare(
        `INSERT INTO note_versions (id, note_id, version, title, markdown, change_kind, created_at)
         VALUES (?, ?, 1, ?, ?, 'create', ?)`,
      )
      .run(randomUUID(), id, input.title, input.markdown, now);
    this.syncLinks(this.get(id)!);
    return this.get(id)!;
  }

  get(id: string): NoteRecord | undefined {
    return this.database.prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteRecord | undefined;
  }

  list(projectId: string): NoteRecord[] {
    return this.database
      .prepare('SELECT * FROM notes WHERE project_id = ? ORDER BY updated_at DESC')
      .all(projectId) as NoteRecord[];
  }

  update(input: {
    noteId: string;
    title?: string;
    markdown?: string;
    changeKind?: NoteVersionRecord['change_kind'];
  }): NoteRecord | undefined {
    const existing = this.get(input.noteId);
    if (!existing) return undefined;
    const title = input.title ?? existing.title;
    const markdown = input.markdown ?? existing.markdown;
    const version = existing.current_version + 1;
    const now = new Date().toISOString();
    writeFileSync(existing.file_path, markdown, 'utf8');
    this.database
      .prepare(
        `UPDATE notes SET title = ?, markdown = ?, current_version = ?, updated_at = ? WHERE id = ?`,
      )
      .run(title, markdown, version, now, input.noteId);
    this.database
      .prepare(
        `INSERT INTO note_versions (id, note_id, version, title, markdown, change_kind, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), input.noteId, version, title, markdown, input.changeKind ?? 'edit', now);
    const updated = this.get(input.noteId)!;
    this.syncLinks(updated);
    return updated;
  }

  versions(noteId: string): NoteVersionRecord[] {
    return this.database
      .prepare('SELECT * FROM note_versions WHERE note_id = ? ORDER BY version DESC')
      .all(noteId) as NoteVersionRecord[];
  }

  delete(noteId: string): boolean {
    const note = this.get(noteId);
    if (!note) return false;
    const trash = join(this.dataRoot, 'projects', note.project_id, 'artifacts', 'trash');
    mkdirSync(trash, { recursive: true });
    renameSync(note.file_path, join(trash, `${note.id}-${Date.now()}.md`));
    this.database.transaction(() => {
      this.database.prepare("UPDATE note_links SET target_status='missing_source' WHERE target_type='note' AND target_id=?").run(noteId);
      this.database.prepare('DELETE FROM notes WHERE id=?').run(noteId);
    })();
    return true;
  }

  restoreVersion(noteId: string, version: number): NoteRecord | undefined {
    const target = this.versions(noteId).find((item) => item.version === version);
    if (!target) return undefined;
    return this.update({ noteId, title: target.title, markdown: target.markdown, changeKind: 'restore' });
  }

  links(noteId: string): NoteLinkRecord[] {
    return this.database.prepare('SELECT * FROM note_links WHERE note_id = ?').all(noteId) as NoteLinkRecord[];
  }

  private syncLinks(note: NoteRecord): void {
    const now = new Date().toISOString();
    const matches = [...note.markdown.matchAll(/\[\[(term|note|doc|section|web):([^\]|]+)(?:\|([^\]]+))?\]\]/gu)];
    this.database.transaction(() => {
      this.database.prepare('DELETE FROM note_links WHERE note_id = ?').run(note.id);
      const statement = this.database.prepare(
        `INSERT OR IGNORE INTO note_links (
           id, project_id, note_id, target_type, target_id, target_status, link_text, created_at
         ) VALUES (?, ?, ?, ?, ?, 'ready', ?, ?)`,
      );
      for (const match of matches) {
        statement.run(
          randomUUID(),
          note.project_id,
          note.id,
          match[1] as NoteLinkRecord['target_type'],
          match[1] === 'doc' ? match[2]!.replace(/#page=\d+$/u, '') : match[2]!,
          match[3] ?? `${match[1]}:${match[2]}`,
          now,
        );
      }
    })();
  }
}
