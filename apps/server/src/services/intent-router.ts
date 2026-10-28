import type { AiActionType } from './prompts';
import { needsArtifact } from './evidence';

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

export function routeReadingIntent(input: IntentInput): IntentRoute {
  if (input.forceAgent) {
    return { kind: 'agent_task', reason: '用户显式要求深度研究' };
  }
  const text = [input.instruction, input.selection]
    .filter((value): value is string => typeof value === 'string')
    .join('\n');
  if (needsArtifact(text)) {
    return { kind: 'agent_task', reason: '任务需要操作笔记或脑图产物' };
  }
  if (input.action) {
    return { kind: 'direct_action', action: input.action, reason: '命中的是单步阅读动作' };
  }
  return { kind: 'direct_action', action: 'content_interpretation', reason: '默认采用内容解读' };
}
