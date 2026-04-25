import { addSubnetIdentifiers, resolveEcsSubnetIds } from '../shared.js';
import type { PlacementEnricher } from '../types.js';

const ECS_NETWORKED_RESOURCES = ['aws_ecs_service', 'aws_ecs_task_set'] as const;

export const EcsPlacementEnricher: PlacementEnricher = {
  id: 'ecs',
  resources: new Set<string>(ECS_NETWORKED_RESOURCES),
  apply: ({ values, context, subnetKeys, explicitVpcId }) => {
    addSubnetIdentifiers(resolveEcsSubnetIds(values), context, subnetKeys, explicitVpcId);
  },
};
