import { randomUUID } from 'node:crypto';
import type { Database } from '../database';

export interface Project {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectListItem extends Project {
  document_count: number;
  last_activity_at: string | null;
}

export class ProjectRepository {
  constructor(private readonly database: Database) {}

  create(name: string): Project {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO projects (id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(id, name.trim(), now, now);
    return this.get(id)!;
  }

  get(id: string): Project | undefined {
    return this.database.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Project | undefined;
  }

  list(): ProjectListItem[] {
    return this.database
      .prepare(
        `SELECT p.*,
                COUNT(pd.document_id) AS document_count,
                MAX(COALESCE(j.updated_at, pd.added_at, p.updated_at)) AS last_activity_at
         FROM projects p
         LEFT JOIN project_documents pd ON pd.project_id = p.id
         LEFT JOIN jobs j ON j.project_id = p.id
         GROUP BY p.id
         ORDER BY p.updated_at DESC`,
      )
      .all() as ProjectListItem[];
  }

  rename(id: string, name: string): Project | undefined {
    const result = this.database
      .prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?')
      .run(name.trim(), new Date().toISOString(), id);
    return result.changes > 0 ? this.get(id) : undefined;
  }

  delete(id: string): boolean {
    return this.database.prepare('DELETE FROM projects WHERE id = ?').run(id).changes > 0;
  }
}
