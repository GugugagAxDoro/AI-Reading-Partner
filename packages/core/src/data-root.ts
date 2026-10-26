import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

export function resolveDataRoot(override?: string): string {
  if (override?.trim()) return override.trim();
  if (process.env.AI_READING_PARTNER_DATA_DIR?.trim()) {
    return process.env.AI_READING_PARTNER_DATA_DIR.trim();
  }

  switch (platform()) {
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', 'AI Reading Partner');
    case 'win32':
      return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'AI Reading Partner');
    default:
      return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'ai-reading-partner');
  }
}

export function ensureDataRoot(dataRoot: string): string {
  const paths = [
    dataRoot,
    join(dataRoot, 'config'),
    join(dataRoot, 'documents'),
    join(dataRoot, 'projects'),
    join(dataRoot, 'tmp'),
  ];
  for (const path of paths) mkdirSync(path, { recursive: true });
  return dataRoot;
}
