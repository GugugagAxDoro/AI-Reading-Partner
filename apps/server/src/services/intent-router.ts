import type { AiActionType } from './prompts';

export interface IntentInput {
  action?: AiActionType;
  selection?: string | null;
  instruction?: string | null;
  forceAgent?: boolean;
}

export interface IntentRoute {
  kind: 'direct_action' | 'agent_task';
  action?: AiActionType;
  reason: string;
}

const agentSignals = [
  '研究',
  '调查',
  '总结全',
  '联网',
  '跨书',
  '跨文档',
  '对比',
  '整理成',
  '生成笔记',
  '脑图',
  '思维导图',
];

export function routeReadingIntent(input: IntentInput): IntentRoute {
  if (input.forceAgent) {
    return { kind: 'agent_task', reason: '用户显式要求深度研究' };
  }
  const text = [input.instruction, input.selection]
    .filter((value): value is string => typeof value === 'string')
    .join('\n');
  if (agentSignals.some((signal) => text.toLowerCase().includes(signal))) {
    return { kind: 'agent_task', reason: '任务包含多步研究或联网信号' };
  }
  if (input.instruction && input.instruction.length > 120) {
    return { kind: 'agent_task', reason: '自定义指令较长，可能需要多步证据' };
  }
  if (input.action) {
    return { kind: 'direct_action', action: input.action, reason: '命中的是单步阅读动作' };
  }
  return { kind: 'direct_action', action: 'content_interpretation', reason: '默认采用内容解读' };
}
