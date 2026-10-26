export type AiActionType =
  | 'vocabulary_explanation'
  | 'content_interpretation'
  | 'custom_question';

export const PROMPT_VERSION = 'reading-assistant-v2';

export interface PromptContext {
  selectedText: string;
  instruction?: string | null;
  title: string;
  page: number;
  sectionTitle?: string | null;
  nearbyContext?: string | null;
  language: string;
}

export interface PromptMessages {
  system: string;
  user: string;
}

export function buildPromptMessages(
  action: AiActionType,
  context: PromptContext,
): PromptMessages {
  const system =
    '你是一个严谨的阅读助手。只根据提供的阅读上下文回答，不要编造没有依据的内容。' +
    `如果上下文不足，请明确说明信息不足。默认回答语言是 ${context.language}。`;

  const contextBlock = [
    `文档标题：${context.title}`,
    `页码：${context.page}`,
    context.sectionTitle ? `所在章节：${context.sectionTitle}` : null,
    context.nearbyContext ? `局部上下文：\n${context.nearbyContext}` : null,
    context.selectedText ? `选中文本：\n${context.selectedText}` : null,
    context.instruction ? `用户补充指令：${context.instruction}` : null,
  ].filter(Boolean).join('\n\n');

  const user = action === 'vocabulary_explanation'
    ? `请使用 Markdown 解释词汇在当前语境中的含义，补充必要背景和易混概念，区分证据与推断。\n\n${contextBlock}`
    : action === 'content_interpretation'
      ? `请使用 Markdown 深度解读选中文本的核心观点、推理过程、隐含假设和理解难点。只依据上下文，不自动扩展为联网研究。\n\n${contextBlock}`
      : `请根据用户指令和阅读上下文回答。\n\n${contextBlock}`;

  return { system, user };
}

export const SUMMARY_PROMPT_VERSION = 'summary-v1';

export function buildChunkGroupSummaryMessages(input: {
  title: string;
  sectionTitle?: string | null;
  content: string;
  language: string;
}): PromptMessages {
  return {
    system:
      `你是阅读索引助手。请将文档片段压缩成适合后续汇总的结构化要点。回答语言是 ${input.language}。` +
      '不要添加原文没有的信息，保留关键概念、论点和数据。',
    user: [
      `文档：${input.title}`,
      input.sectionTitle ? `章节：${input.sectionTitle}` : null,
      '片段内容：',
      input.content,
    ].filter(Boolean).join('\n\n'),
  };
}

export function buildSummaryMessages(input: {
  title: string;
  sectionTitle?: string | null;
  scope: 'book' | 'section' | 'project';
  evidence: string;
  language: string;
}): PromptMessages {
  const instruction = input.scope === 'book'
    ? '请生成全书宏观小结，覆盖主题、结构、核心论证和适合读者的要点。不要展开成逐章笔记。'
    : input.scope === 'section'
      ? '请生成章节小结，覆盖本节主题、关键论点和结论。'
      : '请生成项目级小结，比较各书的主题、方法和互补关系，说明证据缺口。';

  return {
    system:
      `你是阅读摘要助手。只依据提供的证据总结，不要编造内容。回答语言是 ${input.language}。` +
      '输出使用 Markdown，包含 2-5 个小节和简短要点列表。',
    user: [
      `文档：${input.title}`,
      input.sectionTitle ? `章节：${input.sectionTitle}` : null,
      instruction,
      '证据：',
      input.evidence,
    ].filter(Boolean).join('\n\n'),
  };
}
