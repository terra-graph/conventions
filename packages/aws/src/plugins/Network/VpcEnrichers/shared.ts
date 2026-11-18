import {
  type AdapterOperations,
  type NodeId,
  type TgNodeAttributes,
  isObjectRecord,
} from '@terra-graph/core';
import type { PlacementContext, SubnetInfo } from './types.js';
export { isObjectRecord };

export const toStringValue = (value: unknown): string | undefined => {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
};

export const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => toStringValue(entry))
    .filter((entry): entry is string => entry !== undefined);
};

const toRecordArray = (value: unknown): Record<string, unknown>[] => {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is Record<string, unknown> => isObjectRecord(entry));
  }

  if (isObjectRecord(value)) {
    return [value];
  }

  return [];
};

const walkNestedValues = (
  value: unknown,
  onEntry: (key: string, entry: unknown) => void,
  seen: Set<unknown> = new Set<unknown>(),
): void => {
  if (!value || typeof value !== 'object') {
    return;
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const entry of value) {
      walkNestedValues(entry, onEntry, seen);
    }
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    onEntry(key, entry);
    walkNestedValues(entry, onEntry, seen);
  }
};

export const readStateValues = (node: TgNodeAttributes): Record<string, unknown> => {
  const state = node.terraform?.state;
  const effective = state?.effective;
  if (!effective || !isObjectRecord(effective.values)) {
    return {};
  }

  return effective.values;
};

export const resolveReferencedVpcIds = (values: Record<string, unknown>): string[] => {
  const vpcIds = new Set<string>();

  const explicitVpcId = toStringValue(values.vpc_id);
  if (explicitVpcId) {
    vpcIds.add(explicitVpcId);
  }

  const nestedBlocks = [
    ...toRecordArray(values.vpc_config),
    ...toRecordArray(values.network_configuration),
  ];

  for (const block of nestedBlocks) {
    const nestedVpcId = toStringValue(block.vpc_id);
    if (nestedVpcId) {
      vpcIds.add(nestedVpcId);
    }
  }

  walkNestedValues(values, (key, entry) => {
    if (key !== 'vpc_id') {
      return;
    }

    const vpcId = toStringValue(entry);
    if (vpcId) {
      vpcIds.add(vpcId);
    }
  });

  return [...vpcIds];
};

export const resolveReferencedSubnetIds = (values: Record<string, unknown>): string[] => {
  const subnetIds = new Set<string>();

  for (const subnetId of [
    ...toStringArray(values.subnet_ids),
    ...toStringArray(values.subnets),
    ...toStringArray(values.vpc_zone_identifier),
    ...[toStringValue(values.subnet_id)].filter((entry): entry is string => entry !== undefined),
  ]) {
    subnetIds.add(subnetId);
  }

  const nestedBlocks = [
    ...toRecordArray(values.vpc_config),
    ...toRecordArray(values.network_configuration),
  ];

  for (const block of nestedBlocks) {
    for (const subnetId of [
      ...toStringArray(block.subnet_ids),
      ...toStringArray(block.subnets),
      ...[toStringValue(block.subnet_id)].filter((entry): entry is string => entry !== undefined),
    ]) {
      subnetIds.add(subnetId);
    }
  }

  walkNestedValues(values, (key, entry) => {
    if (key === 'subnet_id') {
      const subnetId = toStringValue(entry);
      if (subnetId) {
        subnetIds.add(subnetId);
      }
      return;
    }

    if (
      key === 'subnet_ids' ||
      key === 'subnets' ||
      key === 'client_subnets' ||
      key === 'vpc_zone_identifier'
    ) {
      for (const subnetId of toStringArray(entry)) {
        subnetIds.add(subnetId);
      }
    }
  });

  return [...subnetIds];
};

export const resolveReferencedSubnetGroupIds = (values: Record<string, unknown>): string[] => {
  const subnetGroupIds = new Set<string>();

  walkNestedValues(values, (key, entry) => {
    if (
      key === 'subnet_group' ||
      /^subnet_group_(name|id)$/.test(key) ||
      /_subnet_group_(name|id)$/.test(key)
    ) {
      const subnetGroupId = toStringValue(entry);
      if (subnetGroupId) {
        subnetGroupIds.add(subnetGroupId);
      }
      return;
    }

    if (/^subnet_group_(names|ids)$/.test(key) || /_subnet_group_(names|ids)$/.test(key)) {
      for (const subnetGroupId of toStringArray(entry)) {
        subnetGroupIds.add(subnetGroupId);
      }
    }
  });

  return [...subnetGroupIds];
};

export const toTerraformAddress = (node: TgNodeAttributes): string | undefined => {
  const explicitAddress = toStringValue(node.terraform?.address);
  if (explicitAddress) {
    return explicitAddress;
  }

  const state = node.terraform?.state;
  const effective = state?.effective;
  if (!effective || !isObjectRecord(effective)) {
    return undefined;
  }

  return toStringValue(effective.address);
};

export const toModulePath = (terraformAddress: string | undefined): string | undefined => {
  if (!terraformAddress) {
    return undefined;
  }

  const segments = terraformAddress.split('.');
  const moduleSegments: string[] = [];
  let index = 0;
  while (
    index + 1 < segments.length &&
    segments[index] === 'module' &&
    typeof segments[index + 1] === 'string' &&
    segments[index + 1].length > 0
  ) {
    moduleSegments.push(segments[index], segments[index + 1]);
    index += 2;
  }

  return moduleSegments.length > 0 ? moduleSegments.join('.') : undefined;
};

export const toModulePathCandidates = (modulePath: string | undefined): string[] => {
  if (!modulePath) {
    return [];
  }

  const segments = modulePath.split('.');
  const candidates: string[] = [];
  for (let length = segments.length; length >= 2; length -= 2) {
    if (segments[length - 2] !== 'module') {
      continue;
    }

    const candidate = segments.slice(0, length).join('.');
    if (candidate.length > 0) {
      candidates.push(candidate);
    }
  }

  return candidates;
};

export const resolveUniqueVpcKeyFromModulePath = (
  modulePath: string | undefined,
  vpcModulePathToKeys: Map<string, Set<string>>,
): string | undefined => {
  for (const candidate of toModulePathCandidates(modulePath)) {
    const candidateKeys = vpcModulePathToKeys.get(candidate);
    if (candidateKeys?.size === 1) {
      return [...candidateKeys][0];
    }
  }

  return undefined;
};

export const linkGroupIdentifier = (
  groupMap: Map<string, NodeId>,
  identifier: string | undefined,
  nodeId: NodeId,
): void => {
  if (!identifier) {
    return;
  }
  groupMap.set(identifier, nodeId);
};

export const getOrCreateGroupNodeMap = (
  context: PlacementContext,
  groupKind: string,
): Map<string, NodeId> => {
  const existing = context.groupNameToNodeId.get(groupKind);
  if (existing) {
    return existing;
  }

  const created = new Map<string, NodeId>();
  context.groupNameToNodeId.set(groupKind, created);
  return created;
};

export const resolveNeighborSubnetKeys = (
  nodeId: NodeId,
  graph: AdapterOperations,
  subnetNodeToKey: Map<string, string>,
): Set<string> => {
  const neighbors = new Set<NodeId>([...graph.predecessors(nodeId), ...graph.successors(nodeId)]);

  const subnetKeys = new Set<string>();
  for (const neighborId of neighbors) {
    const subnetKey = subnetNodeToKey.get(String(neighborId));
    if (subnetKey) {
      subnetKeys.add(subnetKey);
    }
  }

  return subnetKeys;
};

export const resolveNeighborVpcKeys = (
  nodeId: NodeId,
  graph: AdapterOperations,
  vpcNodeToKey: Map<string, string>,
): Set<string> => {
  const neighbors = new Set<NodeId>([...graph.predecessors(nodeId), ...graph.successors(nodeId)]);

  const vpcKeys = new Set<string>();
  for (const neighborId of neighbors) {
    const vpcKey = vpcNodeToKey.get(String(neighborId));
    if (vpcKey) {
      vpcKeys.add(vpcKey);
    }
  }

  return vpcKeys;
};

export const addSubnetIdentifier = (
  subnetId: string,
  context: PlacementContext,
  subnetKeys: Set<string>,
  explicitVpcId?: string,
): void => {
  const existing = context.subnetIdentifierToKey.get(subnetId);
  if (existing) {
    subnetKeys.add(existing);
    return;
  }

  const inferredSubnet: SubnetInfo = {
    key: subnetId,
    label: subnetId,
    vpcReferences: new Set<string>(),
  };

  if (explicitVpcId) {
    inferredSubnet.vpcReferences.add(explicitVpcId);
    let explicitVpcKey = context.vpcIdentifierToKey.get(explicitVpcId);
    if (!explicitVpcKey) {
      context.vpcs.set(explicitVpcId, {
        key: explicitVpcId,
        label: explicitVpcId,
      });
      context.vpcIdentifierToKey.set(explicitVpcId, explicitVpcId);
      explicitVpcKey = explicitVpcId;
    }

    inferredSubnet.vpcKey = explicitVpcKey;
  }

  context.subnets.set(subnetId, inferredSubnet);
  context.subnetIdentifierToKey.set(subnetId, subnetId);
  subnetKeys.add(subnetId);
};

export const addSubnetIdentifiers = (
  subnetIds: string[],
  context: PlacementContext,
  subnetKeys: Set<string>,
  explicitVpcId?: string,
): void => {
  for (const subnetId of subnetIds) {
    addSubnetIdentifier(subnetId, context, subnetKeys, explicitVpcId);
  }
};

export const resolveSubnetsFromGroupByName = (
  groupKind: string,
  groupName: string | undefined,
  context: PlacementContext,
): Set<string> => {
  if (!groupName) {
    return new Set<string>();
  }

  const groupNodeId = context.groupNameToNodeId.get(groupKind)?.get(groupName);
  if (!groupNodeId) {
    return new Set<string>();
  }

  return resolveNeighborSubnetKeys(groupNodeId, context.graph, context.subnetNodeToKey);
};
