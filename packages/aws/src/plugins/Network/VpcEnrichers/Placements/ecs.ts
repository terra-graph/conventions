import type { NodeId, TgNodeAttributes } from '@terra-graph/core';
import {
  addSubnetIdentifiers,
  getOrCreateGroupNodeMap,
  linkGroupIdentifier,
  readStateValues,
  toStringArray,
  toStringValue,
} from '../shared.js';
import type { PlacementEnricher } from '../types.js';

const ECS_SERVICE_RESOURCE = 'aws_ecs_service';
const ECS_TASK_SET_RESOURCE = 'aws_ecs_task_set';
const ECS_TASK_DEFINITION_RESOURCE = 'aws_ecs_task_definition';
const ECS_TASK_DEFINITION_GROUP_KIND = 'ecs.task_definition';
const ECS_AWSVPC_NETWORK_MODE = 'awsvpc';

const ECS_RUNTIME_RESOURCES = new Set<string>([ECS_SERVICE_RESOURCE, ECS_TASK_SET_RESOURCE]);

const ECS_PLACEMENT_RESOURCES = new Set<string>([
  ECS_SERVICE_RESOURCE,
  ECS_TASK_SET_RESOURCE,
  ECS_TASK_DEFINITION_RESOURCE,
]);

const indexTaskDefinitionIdentifier = (
  taskDefinitions: Map<string, NodeId>,
  identifier: string | undefined,
  nodeId: NodeId,
): void => {
  linkGroupIdentifier(taskDefinitions, identifier, nodeId);
};

const resolveTaskDefinitionNodeId = (
  nodeId: NodeId,
  node: TgNodeAttributes,
  values: Record<string, unknown>,
  context: Parameters<Exclude<PlacementEnricher['apply'], undefined>>[0]['context'],
): NodeId | undefined => {
  const neighbors = [...context.graph.predecessors(nodeId), ...context.graph.successors(nodeId)].sort(
    (left, right) => String(left).localeCompare(String(right)),
  );

  for (const neighborId of neighbors) {
    const neighbor = context.graph.getNodeAttributes(neighborId);
    if (toStringValue(neighbor?.terraform?.resource) === ECS_TASK_DEFINITION_RESOURCE) {
      return neighborId;
    }
  }

  const taskDefinitionRef = toStringValue(values.task_definition);
  if (!taskDefinitionRef) {
    return undefined;
  }

  return context.groupNameToNodeId.get(ECS_TASK_DEFINITION_GROUP_KIND)?.get(taskDefinitionRef);
};

const addConfiguredSubnets = (
  values: Record<string, unknown>,
  context: Parameters<Exclude<PlacementEnricher['apply'], undefined>>[0]['context'],
  subnetKeys: Set<string>,
  explicitVpcId: string | undefined,
): void => {
  addSubnetIdentifiers(
    [
      ...toStringArray(values.subnet_ids),
      ...toStringArray(values.subnets),
      ...[toStringValue(values.subnet_id)].filter((entry): entry is string => entry !== undefined),
    ],
    context,
    subnetKeys,
    explicitVpcId,
  );

  const networkConfigurations = Array.isArray(values.network_configuration)
    ? values.network_configuration
    : [values.network_configuration];

  for (const networkConfiguration of networkConfigurations) {
    if (!networkConfiguration || typeof networkConfiguration !== 'object') {
      continue;
    }

    addSubnetIdentifiers(
      [
        ...toStringArray((networkConfiguration as Record<string, unknown>).subnet_ids),
        ...toStringArray((networkConfiguration as Record<string, unknown>).subnets),
        ...[
          toStringValue((networkConfiguration as Record<string, unknown>).subnet_id),
        ].filter((entry): entry is string => entry !== undefined),
      ],
      context,
      subnetKeys,
      explicitVpcId ?? toStringValue((networkConfiguration as Record<string, unknown>).vpc_id),
    );
  }
};

const addNeighborDefinedSubnets = (
  startNodeId: NodeId,
  context: Parameters<Exclude<PlacementEnricher['apply'], undefined>>[0]['context'],
  subnetKeys: Set<string>,
  explicitVpcId: string | undefined,
  maxDepth = 5,
): void => {
  const queue: Array<{ nodeId: NodeId; depth: number }> = [{ nodeId: startNodeId, depth: 0 }];
  const visited = new Set<NodeId>([startNodeId]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    if (current.depth >= maxDepth) {
      continue;
    }

    const neighbors = [...context.graph.predecessors(current.nodeId), ...context.graph.successors(current.nodeId)]
      .filter((neighborId) => !visited.has(neighborId))
      .sort((left, right) => String(left).localeCompare(String(right)));

    for (const neighborId of neighbors) {
      visited.add(neighborId);

      const neighbor = context.graph.getNodeAttributes(neighborId);
      if (!neighbor) {
        continue;
      }

      const subnetKey = context.subnetNodeToKey.get(neighborId);
      if (subnetKey) {
        subnetKeys.add(subnetKey);
        continue;
      }

      const sizeBefore = subnetKeys.size;
      addConfiguredSubnets(readStateValues(neighbor), context, subnetKeys, explicitVpcId);
      if (subnetKeys.size > sizeBefore) {
        continue;
      }

      queue.push({ nodeId: neighborId, depth: current.depth + 1 });
    }
  }
};

const addRuntimeSubnets = (
  nodeId: NodeId,
  values: Record<string, unknown>,
  context: Parameters<Exclude<PlacementEnricher['apply'], undefined>>[0]['context'],
  subnetKeys: Set<string>,
  explicitVpcId: string | undefined,
): void => {
  addConfiguredSubnets(values, context, subnetKeys, explicitVpcId);
  if (subnetKeys.size > 0) {
    return;
  }

  addNeighborDefinedSubnets(nodeId, context, subnetKeys, explicitVpcId);
};

const addPlannedNeighborSubnets = (
  startNodeId: NodeId,
  context: Parameters<Exclude<PlacementEnricher['reconcilePlacement'], undefined>>[0]['context'],
  plannedSubnetKeysByNodeId: ReadonlyMap<NodeId, readonly string[]>,
  subnetKeys: Set<string>,
  explicitVpcId: string | undefined,
): void => {
  const explicitVpcKey = explicitVpcId
    ? (context.vpcIdentifierToKey.get(explicitVpcId) ?? explicitVpcId)
    : undefined;
  const neighbors = [...context.graph.predecessors(startNodeId), ...context.graph.successors(startNodeId)]
    .sort((left, right) => String(left).localeCompare(String(right)));

  for (const neighborId of neighbors) {
    for (const subnetKey of plannedSubnetKeysByNodeId.get(neighborId) ?? []) {
      if (explicitVpcKey) {
        const subnetVpcKey = context.subnets.get(subnetKey)?.vpcKey;
        if (subnetVpcKey && subnetVpcKey !== explicitVpcKey) {
          continue;
        }
      }

      subnetKeys.add(subnetKey);
    }
  }
};

export const EcsPlacementEnricher: PlacementEnricher = {
  id: 'ecs',
  resources: ECS_PLACEMENT_RESOURCES,
  indexNode: ({ nodeId, values, context, resource, address, name }) => {
    if (resource !== ECS_TASK_DEFINITION_RESOURCE) {
      return;
    }

    const taskDefinitions = getOrCreateGroupNodeMap(context, ECS_TASK_DEFINITION_GROUP_KIND);
    const family = toStringValue(values.family);
    const revision =
      typeof values.revision === 'number' ? String(values.revision) : toStringValue(values.revision);

    indexTaskDefinitionIdentifier(taskDefinitions, toStringValue(values.arn), nodeId);
    indexTaskDefinitionIdentifier(taskDefinitions, family, nodeId);
    indexTaskDefinitionIdentifier(
      taskDefinitions,
      family && revision ? `${family}:${revision}` : undefined,
      nodeId,
    );
    indexTaskDefinitionIdentifier(taskDefinitions, name, nodeId);
    indexTaskDefinitionIdentifier(taskDefinitions, address, nodeId);
    indexTaskDefinitionIdentifier(taskDefinitions, String(nodeId), nodeId);
  },
  apply: ({ nodeId, node, values, context, subnetKeys, explicitVpcId, controls }) => {
    const resource = toStringValue(node.terraform?.resource);
    if (resource === ECS_TASK_DEFINITION_RESOURCE) {
      if (toStringValue(values.network_mode) !== ECS_AWSVPC_NETWORK_MODE) {
        controls.suppressPlacement = true;
        return;
      }

      const neighbors = [...context.graph.predecessors(nodeId), ...context.graph.successors(nodeId)].sort(
        (left, right) => String(left).localeCompare(String(right)),
      );

      for (const neighborId of neighbors) {
        const neighbor = context.graph.getNodeAttributes(neighborId);
        if (!neighbor) {
          continue;
        }

        const neighborResource = toStringValue(neighbor.terraform?.resource);
        if (!neighborResource || !ECS_RUNTIME_RESOURCES.has(neighborResource)) {
          continue;
        }

        const neighborValues = readStateValues(neighbor);
        const resolvedTaskDefinitionNodeId = resolveTaskDefinitionNodeId(
          neighborId,
          neighbor,
          neighborValues,
          context,
        );
        if (resolvedTaskDefinitionNodeId !== nodeId) {
          continue;
        }

        addRuntimeSubnets(neighborId, neighborValues, context, subnetKeys, explicitVpcId);
      }

      return;
    }

    if (!resource || !ECS_RUNTIME_RESOURCES.has(resource)) {
      return;
    }

    const taskDefinitionNodeId = resolveTaskDefinitionNodeId(nodeId, node, values, context);
    if (!taskDefinitionNodeId) {
      controls.suppressPlacement = true;
      return;
    }

    const taskDefinition = context.graph.getNodeAttributes(taskDefinitionNodeId);
    if (!taskDefinition) {
      controls.suppressPlacement = true;
      return;
    }

    const taskDefinitionValues = readStateValues(taskDefinition);
    if (toStringValue(taskDefinitionValues.network_mode) !== ECS_AWSVPC_NETWORK_MODE) {
      controls.suppressPlacement = true;
      return;
    }

    addRuntimeSubnets(nodeId, values, context, subnetKeys, explicitVpcId);
  },
  reconcilePlacement: ({
    nodeId,
    node,
    values,
    context,
    subnetKeys,
    explicitVpcId,
    controls,
    plannedSubnetKeysByNodeId,
  }) => {
    if (controls.suppressPlacement || subnetKeys.size > 0) {
      return;
    }

    const resource = toStringValue(node.terraform?.resource);
    if (resource === ECS_TASK_DEFINITION_RESOURCE) {
      const neighbors = [...context.graph.predecessors(nodeId), ...context.graph.successors(nodeId)].sort(
        (left, right) => String(left).localeCompare(String(right)),
      );

      for (const neighborId of neighbors) {
        const neighbor = context.graph.getNodeAttributes(neighborId);
        if (!neighbor) {
          continue;
        }

        const neighborResource = toStringValue(neighbor.terraform?.resource);
        if (!neighborResource || !ECS_RUNTIME_RESOURCES.has(neighborResource)) {
          continue;
        }

        const neighborValues = readStateValues(neighbor);
        const resolvedTaskDefinitionNodeId = resolveTaskDefinitionNodeId(
          neighborId,
          neighbor,
          neighborValues,
          context,
        );
        if (resolvedTaskDefinitionNodeId !== nodeId) {
          continue;
        }

        for (const subnetKey of plannedSubnetKeysByNodeId.get(neighborId) ?? []) {
          subnetKeys.add(subnetKey);
        }
      }

      return;
    }

    if (!resource || !ECS_RUNTIME_RESOURCES.has(resource)) {
      return;
    }

    if (!resolveTaskDefinitionNodeId(nodeId, node, values, context)) {
      controls.suppressPlacement = true;
      return;
    }

    addPlannedNeighborSubnets(
      nodeId,
      context,
      plannedSubnetKeysByNodeId,
      subnetKeys,
      explicitVpcId,
    );
  },
};
