import type { ProviderFile } from './provider-config';
import type { ModelTier } from './model-client';

export type QualityMode = 'fast' | 'balanced' | 'quality';
export type TaskProfile =
  | 'query_generation'
  | 'chunk_summary'
  | 'evidence_judging'
  | 'simple_explanation'
  | 'complex_qa'
  | 'final_synthesis'
  | 'document_summary'
  | 'project_summary'
  | 'note_writing'
  | 'mind_map_structure'
  | 'agent_planning';

const baseProfileTier: Record<TaskProfile, ModelTier> = {
  query_generation: 'light',
  chunk_summary: 'light',
  evidence_judging: 'light',
  simple_explanation: 'light',
  complex_qa: 'strong',
  final_synthesis: 'strong',
  document_summary: 'strong',
  project_summary: 'strong',
  note_writing: 'strong',
  mind_map_structure: 'strong',
  agent_planning: 'strong',
};

const fastModeStrongProfiles = new Set<TaskProfile>([
  'complex_qa',
  'final_synthesis',
  'document_summary',
  'project_summary',
  'note_writing',
  'mind_map_structure',
  'agent_planning',
]);

const qualityModeLightPromotion = new Set<TaskProfile>([
  'evidence_judging',
  'simple_explanation',
]);

export function resolveTaskTier(profile: TaskProfile, qualityMode: QualityMode): ModelTier {
  const configuredMode = qualityMode;
  if (configuredMode === 'fast' && !fastModeStrongProfiles.has(profile)) return 'light';
  if (configuredMode === 'quality' && qualityModeLightPromotion.has(profile)) return 'strong';
  return baseProfileTier[profile];
}

export function resolveRouting(config: ProviderFile, profile: TaskProfile): {
  tier: ModelTier;
  qualityMode: QualityMode;
  providerId: string;
  model: string;
} {
  const qualityMode = config.settings.quality_mode;
  const tier = resolveTaskTier(profile, qualityMode);
  const modelConfig = config.models[tier];
  return {
    tier,
    qualityMode,
    providerId: modelConfig.provider,
    model: modelConfig.model,
  };
}
