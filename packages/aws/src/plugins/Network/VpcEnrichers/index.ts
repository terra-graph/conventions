import { EfsPlacementEnricher } from './Placements/efs.js';
import { NetworkPlacementEnricher } from './Placements/network.js';
import { isObjectRecord } from './shared.js';
import type {
  AwsNetworkPlacementEnricherId,
  AwsNetworkPlacementPluginOptions,
  AwsNetworkVisibilityMode,
  PlacementEnricher,
} from './types.js';

export type {
  AwsNetworkPlacementEnricherId,
  AwsNetworkPlacementPluginOptions,
  AwsNetworkVisibilityMode,
  EnricherApplyInput,
  EnricherIndexInput,
  PlacementContext,
  PlacementEnricher,
  SubnetInfo,
  VpcInfo,
} from './types.js';

const ENRICHER_REGISTRY: Record<AwsNetworkPlacementEnricherId, PlacementEnricher> = {
  efs: EfsPlacementEnricher,
  network: NetworkPlacementEnricher,
};

const SUPPORTED_ENRICHERS: AwsNetworkPlacementEnricherId[] = ['efs', 'network'];
const SUPPORTED_ENRICHER_SET = new Set<AwsNetworkPlacementEnricherId>(SUPPORTED_ENRICHERS);
const SUPPORTED_VISIBILITY_MODES: AwsNetworkVisibilityMode[] = ['full', 'architecture', 'minimal'];
const SUPPORTED_VISIBILITY_MODE_SET = new Set<AwsNetworkVisibilityMode>(SUPPORTED_VISIBILITY_MODES);

export const resolveAwsNetworkPlacementEnricherIds = (
  value: unknown,
): AwsNetworkPlacementEnricherId[] => {
  if (!isObjectRecord(value)) {
    return [];
  }

  const enrichers = value.enrichers;
  if (!Array.isArray(enrichers)) {
    return [];
  }

  const enabled = new Set<AwsNetworkPlacementEnricherId>();
  for (const enricher of enrichers) {
    if (typeof enricher !== 'string') {
      continue;
    }

    if (SUPPORTED_ENRICHER_SET.has(enricher as AwsNetworkPlacementEnricherId)) {
      enabled.add(enricher as AwsNetworkPlacementEnricherId);
    }
  }

  return [...enabled].sort();
};

export const resolveAwsNetworkPlacementEnrichers = (value: unknown): PlacementEnricher[] => {
  return resolveAwsNetworkPlacementEnricherIds(value)
    .map((enricherId) => ENRICHER_REGISTRY[enricherId])
    .filter((enricher): enricher is PlacementEnricher => !!enricher)
    .sort((left, right) => left.id.localeCompare(right.id));
};

export const resolveAwsNetworkVisibilityMode = (value: unknown): AwsNetworkVisibilityMode => {
  if (!isObjectRecord(value)) {
    return 'full';
  }

  const mode = value.mode;
  if (typeof mode !== 'string') {
    return 'full';
  }

  return SUPPORTED_VISIBILITY_MODE_SET.has(mode as AwsNetworkVisibilityMode)
    ? (mode as AwsNetworkVisibilityMode)
    : 'full';
};

export const resolveAwsNetworkPlacementOptions = (
  value: unknown,
): Required<AwsNetworkPlacementPluginOptions> => {
  return {
    enrichers: resolveAwsNetworkPlacementEnricherIds(value),
    mode: resolveAwsNetworkVisibilityMode(value),
  };
};
