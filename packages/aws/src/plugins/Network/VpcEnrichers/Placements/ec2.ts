import type { NodeId, TgNodeAttributes } from '@terra-graph/core';
import {
  addSubnetIdentifiers,
  getOrCreateGroupNodeMap,
  linkGroupIdentifier,
  readStateValues,
  resolveNeighborSubnetKeys,
  resolveNeighborVpcKeys,
  toStringArray,
  toStringValue,
} from '../shared.js';
import type { PlacementContext, PlacementEnricher } from '../types.js';

const INSTANCE_RESOURCE = 'aws_instance';
const LAUNCH_TEMPLATE_RESOURCE = 'aws_launch_template';
const LAUNCH_CONFIGURATION_RESOURCE = 'aws_launch_configuration';
const AUTOSCALING_GROUP_RESOURCE = 'aws_autoscaling_group';
const SECURITY_GROUP_RESOURCE = 'aws_security_group';

const GROUP_KIND_SECURITY_GROUP = 'ec2.security_group';
const GROUP_KIND_LAUNCH_TEMPLATE = 'ec2.launch_template';
const GROUP_KIND_LAUNCH_CONFIGURATION = 'ec2.launch_configuration';

const toRecordArray = (value: unknown): Record<string, unknown>[] => {
  if (Array.isArray(value)) {
    return value.filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === 'object' && entry !== null && !Array.isArray(entry),
    );
  }

  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return [value as Record<string, unknown>];
  }

  return [];
};

const resolveVpcAndSubnetFromNode = (
  nodeId: NodeId,
  context: PlacementContext,
  subnetKeys: Set<string>,
  vpcKeys: Set<string>,
): void => {
  const node = context.graph.getNodeAttributes(nodeId);
  if (!node) {
    return;
  }

  const values = readStateValues(node);
  const vpcId = toStringValue(values.vpc_id);
  if (vpcId) {
    const existingVpcKey = context.vpcIdentifierToKey.get(vpcId);
    if (existingVpcKey) {
      vpcKeys.add(existingVpcKey);
    } else {
      context.vpcs.set(vpcId, {
        key: vpcId,
        label: vpcId,
      });
      context.vpcIdentifierToKey.set(vpcId, vpcId);
      vpcKeys.add(vpcId);
    }
  }

  addSubnetIdentifiers(
    [
      ...toStringArray(values.subnet_ids),
      ...[toStringValue(values.subnet_id)].filter((entry): entry is string => entry !== undefined),
    ],
    context,
    subnetKeys,
    vpcId,
  );

  for (const subnetKey of resolveNeighborSubnetKeys(
    nodeId,
    context.graph,
    context.subnetNodeToKey,
  )) {
    subnetKeys.add(subnetKey);
  }

  for (const vpcKey of resolveNeighborVpcKeys(nodeId, context.graph, context.vpcNodeToKey)) {
    vpcKeys.add(vpcKey);
  }
};

const resolveFromGroupIdentifier = (
  groupKind: string,
  identifier: string | undefined,
  context: PlacementContext,
  subnetKeys: Set<string>,
  vpcKeys: Set<string>,
): void => {
  if (!identifier) {
    return;
  }

  const referencedNodeId = context.groupNameToNodeId.get(groupKind)?.get(identifier);
  if (!referencedNodeId) {
    return;
  }

  resolveVpcAndSubnetFromNode(referencedNodeId, context, subnetKeys, vpcKeys);
};

const linkNodeIdentifiers = (
  groupKind: string,
  nodeId: NodeId,
  node: TgNodeAttributes,
  values: Record<string, unknown>,
  context: PlacementContext,
  address?: string,
  name?: string,
): void => {
  const groupMap = getOrCreateGroupNodeMap(context, groupKind);
  linkGroupIdentifier(groupMap, toStringValue(values.id), nodeId);
  linkGroupIdentifier(groupMap, toStringValue(values.arn), nodeId);
  linkGroupIdentifier(groupMap, toStringValue(values.name), nodeId);
  linkGroupIdentifier(groupMap, name, nodeId);
  linkGroupIdentifier(groupMap, address, nodeId);
  linkGroupIdentifier(groupMap, toStringValue(node.terraform?.address), nodeId);
  linkGroupIdentifier(groupMap, String(nodeId), nodeId);
};

const resolveSecurityGroupIdentifiers = (values: Record<string, unknown>): string[] => {
  const identifiers = new Set<string>([
    ...toStringArray(values.vpc_security_group_ids),
    ...toStringArray(values.security_groups),
  ]);

  const interfaceBlocks = [
    ...toRecordArray(values.network_interfaces),
    ...toRecordArray(values.network_interface),
  ];
  for (const block of interfaceBlocks) {
    for (const identifier of [
      ...toStringArray(block.vpc_security_group_ids),
      ...toStringArray(block.security_groups),
      ...toStringArray(block.groups),
    ]) {
      identifiers.add(identifier);
    }
  }

  return [...identifiers];
};

const resolveSubnetIdentifiers = (values: Record<string, unknown>): string[] => {
  const identifiers = new Set<string>([
    ...toStringArray(values.subnet_ids),
    ...[toStringValue(values.subnet_id)].filter((entry): entry is string => entry !== undefined),
  ]);

  const interfaceBlocks = [
    ...toRecordArray(values.network_interfaces),
    ...toRecordArray(values.network_interface),
  ];
  for (const block of interfaceBlocks) {
    const subnetId = toStringValue(block.subnet_id);
    if (subnetId) {
      identifiers.add(subnetId);
    }
  }

  return [...identifiers];
};

const resolveLaunchTemplateIdentifiers = (values: Record<string, unknown>): string[] => {
  const identifiers = new Set<string>();

  const launchTemplateBlocks = toRecordArray(values.launch_template);
  for (const block of launchTemplateBlocks) {
    const id = toStringValue(block.id);
    if (id) {
      identifiers.add(id);
    }

    const name = toStringValue(block.name);
    if (name) {
      identifiers.add(name);
    }
  }

  return [...identifiers];
};

export const Ec2PlacementEnricher: PlacementEnricher = {
  id: 'ec2',
  resources: new Set<string>([
    INSTANCE_RESOURCE,
    LAUNCH_TEMPLATE_RESOURCE,
    LAUNCH_CONFIGURATION_RESOURCE,
    AUTOSCALING_GROUP_RESOURCE,
  ]),
  indexNode: ({ nodeId, node, values, context, resource, address, name }) => {
    if (resource === SECURITY_GROUP_RESOURCE) {
      linkNodeIdentifiers(
        GROUP_KIND_SECURITY_GROUP,
        nodeId,
        node,
        values,
        context,
        address,
        name,
      );
      return;
    }

    if (resource === LAUNCH_TEMPLATE_RESOURCE) {
      linkNodeIdentifiers(
        GROUP_KIND_LAUNCH_TEMPLATE,
        nodeId,
        node,
        values,
        context,
        address,
        name,
      );
      return;
    }

    if (resource === LAUNCH_CONFIGURATION_RESOURCE) {
      linkNodeIdentifiers(
        GROUP_KIND_LAUNCH_CONFIGURATION,
        nodeId,
        node,
        values,
        context,
        address,
        name,
      );
    }
  },
  apply: ({ node, values, context, subnetKeys, vpcKeys, explicitVpcId }) => {
    const resource = toStringValue(node.terraform?.resource);
    const resolvedVpcId = explicitVpcId ?? toStringValue(values.vpc_id);
    addSubnetIdentifiers(resolveSubnetIdentifiers(values), context, subnetKeys, resolvedVpcId);

    for (const securityGroupIdentifier of resolveSecurityGroupIdentifiers(values)) {
      resolveFromGroupIdentifier(
        GROUP_KIND_SECURITY_GROUP,
        securityGroupIdentifier,
        context,
        subnetKeys,
        vpcKeys,
      );
    }

    if (resource === AUTOSCALING_GROUP_RESOURCE) {
      for (const launchTemplateIdentifier of resolveLaunchTemplateIdentifiers(values)) {
        resolveFromGroupIdentifier(
          GROUP_KIND_LAUNCH_TEMPLATE,
          launchTemplateIdentifier,
          context,
          subnetKeys,
          vpcKeys,
        );
      }

      resolveFromGroupIdentifier(
        GROUP_KIND_LAUNCH_CONFIGURATION,
        toStringValue(values.launch_configuration),
        context,
        subnetKeys,
        vpcKeys,
      );
    }
  },
};
