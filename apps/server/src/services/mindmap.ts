import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Transformer } from 'markmap-lib';
import { NoteRepository } from '@ai-reading-partner/db';

export interface MindmapResult {
  noteId: string;
  filePath: string;
}

export class MindmapService {
  constructor(
    private readonly dataRoot: string,
    private readonly notes: NoteRepository,
  ) {}

  generate(projectId: string, noteId: string): MindmapResult {
    const note = this.notes.get(noteId);
    if (!note || note.project_id !== projectId) throw new Error('Note not found');

    const outputDirectory = join(this.dataRoot, 'projects', projectId, 'artifacts', 'mindmaps');
    mkdirSync(outputDirectory, { recursive: true });
    const filePath = join(outputDirectory, `${noteId}.html`);
    const transformer = new Transformer();
    const { root } = transformer.transform(note.markdown);
    const html = buildMindmapHtml(note.title, root);
    writeFileSync(filePath, html, 'utf8');
    return { noteId, filePath };
  }

  path(projectId: string, noteId: string): string | undefined {
    const note = this.notes.get(noteId);
    if (!note || note.project_id !== projectId) return undefined;
    return join(this.dataRoot, 'projects', projectId, 'artifacts', 'mindmaps', `${noteId}.html`);
  }
}

function buildMindmapHtml(title: string, root: unknown): string {
  const rendererBundle = readFileSync(
    new URL('../../public/markmap-bundle.js', import.meta.url),
    'utf8',
  );
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - Mind Map</title>
  <style>
    html, body { margin: 0; height: 100%; overflow: hidden; font-family: Inter, "PingFang SC", sans-serif; }
    #mindmap { display: block; width: 100vw; height: 100vh; }
  </style>
</head>
<body>
  <svg id="mindmap"></svg>
  <script>${rendererBundle}</script>
  <script>
    const root = ${JSON.stringify(root).replaceAll('<', '\\u003c')};
    void (async () => {
      const mindmap = markmap.Markmap.create('#mindmap', { duration: 0 });
      await document.fonts.ready;
      await mindmap.setData(root);
      await mindmap.fit();
      document.documentElement.dataset.mindmapReady = 'true';
    })();
  </script>
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
