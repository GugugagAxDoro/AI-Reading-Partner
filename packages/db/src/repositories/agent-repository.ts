import { randomUUID } from 'node:crypto';
import type { Database } from '../database';

export interface AgentRunRecord {
  id: string;
  project_id: string;
  document_id: string | null;
  title: string;
  task: string;
  status: 'pending' | 'running' | 'ready' | 'failed' | 'timeout' | 'cancelled';
  rounds: number;
  max_rounds: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  budget_tokens: number;
  timeout_ms: number;
  result_json: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentStepRecord {
  id: string;
  run_id: string;
  step_number: number;
  type: string;
  title: string;
  status: 'pending' | 'running' | 'ready' | 'failed';
  payload_json: string;
  result_json: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export class AgentRepository {
  constructor(private readonly database: Database) {}

  createRun(input: {
    projectId: string;
    documentId?: string | null;
    title: string;
    task: string;
    maxRounds?: number;
    budgetTokens?: number;
    timeoutMs?: number;
  }): AgentRunRecord {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO agent_runs (
           id, project_id, document_id, title, task, status, max_rounds,
           budget_tokens, timeout_ms, started_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.documentId ?? null,
        input.title,
        input.task,
        input.maxRounds ?? 8,
        input.budgetTokens ?? 120_000,
        input.timeoutMs ?? 180_000,
        now,
        now,
        now,
      );
    return this.getRun(id)!;
  }

  getRun(id: string): AgentRunRecord | undefined {
    return this.database.prepare('SELECT * FROM agent_runs WHERE id = ?').get(id) as AgentRunRecord | undefined;
  }

  listRuns(projectId: string): AgentRunRecord[] {
    return this.database
      .prepare('SELECT * FROM agent_runs WHERE project_id = ? ORDER BY created_at DESC')
      .all(projectId) as AgentRunRecord[];
  }

  updateRun(id: string, update: Partial<Omit<AgentRunRecord, 'id' | 'created_at'>>): AgentRunRecord | undefined {
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(update)) {
      if (value === undefined) continue;
      fields.push(`${key} = ?`);
      values.push(value);
    }
    if (fields.length === 0) return this.getRun(id);
    fields.push('updated_at = ?');
    values.push(new Date().toISOString(), id);
    this.database.prepare(`UPDATE agent_runs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getRun(id);
  }

  addStep(input: {
    runId: string;
    type: string;
    title: string;
    payload?: Record<string, unknown>;
  }): AgentStepRecord {
    const nextNumber = Number(
      (this.database.prepare('SELECT COUNT(*) AS count FROM agent_steps WHERE run_id = ?').get(input.runId) as {
        count?: number;
      }).count ?? 0,
    ) + 1;
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO agent_steps (
           id, run_id, step_number, type, title, status, payload_json, started_at
         ) VALUES (?, ?, ?, ?, ?, 'ready', ?, ?)`,
      )
      .run(id, input.runId, nextNumber, input.type, input.title, JSON.stringify(input.payload ?? {}), now);
    return this.getStep(id)!;
  }

  getStep(id: string): AgentStepRecord | undefined {
    return this.database.prepare('SELECT * FROM agent_steps WHERE id = ?').get(id) as AgentStepRecord | undefined;
  }

  listSteps(runId: string): AgentStepRecord[] {
    return this.database
      .prepare('SELECT * FROM agent_steps WHERE run_id = ? ORDER BY step_number')
      .all(runId) as AgentStepRecord[];
  }
}
