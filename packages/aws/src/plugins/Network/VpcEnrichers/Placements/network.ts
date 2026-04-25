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

const SECURITY_GROUP_RESOURCE = 'aws_security_group';
const SECURITY_GROUP_INGRESS_RULE_RESOURCE = 'aws_vpc_security_group_ingress_rule';
const SECURITY_GROUP_EGRESS_RULE_RESOURCE = 'aws_vpc_security_group_egress_rule';
const NETWORK_ACL_RESOURCE = 'aws_network_acl';
const NETWORK_ACL_RULE_RESOURCE = 'aws_network_acl_rule';
const ROUTE_TABLE_RESOURCE = 'aws_route_table';
const ROUTE_RESOURCE = 'aws_route';
const ROUTE_TABLE_ASSOCIATION_RESOURCE = 'aws_route_table_association';
const MAIN_ROUTE_TABLE_ASSOCIATION_RESOURCE = 'aws_main_route_table_association';
const NAT_GATEWAY_RESOURCE = 'aws_nat_gateway';
const INTERNET_GATEWAY_RESOURCE = 'aws_internet_gateway';
const EGRESS_ONLY_INTERNET_GATEWAY_RESOURCE = 'aws_egress_only_internet_gateway';
const VPC_ENDPOINT_RESOURCE = 'aws_vpc_endpoint';
const LOAD_BALANCER_RESOURCE = 'aws_lb';
const LOAD_BALANCER_LISTENER_RESOURCE = 'aws_lb_listener';

const GROUP_KIND_SECURITY_GROUP = 'network.security_group';
const GROUP_KIND_ROUTE_TABLE = 'network.route_table';
const GROUP_KIND_NETWORK_ACL = 'network.network_acl';
const GROUP_KIND_NAT_GATEWAY = 'network.nat_gateway';
const GROUP_KIND_INTERNET_GATEWAY = 'network.internet_gateway';
const GROUP_KIND_VPC_ENDPOINT = 'network.vpc_endpoint';
const GROUP_KIND_LOAD_BALANCER = 'network.load_balancer';

const INDEXED_GROUP_KIND_BY_RESOURCE: Record<string, string> = {
  [SECURITY_GROUP_RESOURCE]: GROUP_KIND_SECURITY_GROUP,
  [ROUTE_TABLE_RESOURCE]: GROUP_KIND_ROUTE_TABLE,
  [NETWORK_ACL_RESOURCE]: GROUP_KIND_NETWORK_ACL,
  [NAT_GATEWAY_RESOURCE]: GROUP_KIND_NAT_GATEWAY,
  [INTERNET_GATEWAY_RESOURCE]: GROUP_KIND_INTERNET_GATEWAY,
  [EGRESS_ONLY_INTERNET_GATEWAY_RESOURCE]: GROUP_KIND_INTERNET_GATEWAY,
  [VPC_ENDPOINT_RESOURCE]: GROUP_KIND_VPC_ENDPOINT,
  [LOAD_BALANCER_RESOURCE]: GROUP_KIND_LOAD_BALANCER,
};

const NETWORK_PLACEMENT_RESOURCES = new Set<string>([
  SECURITY_GROUP_RESOURCE,
  SECURITY_GROUP_INGRESS_RULE_RESOURCE,
  SECURITY_GROUP_EGRESS_RULE_RESOURCE,
  NETWORK_ACL_RESOURCE,
  NETWORK_ACL_RULE_RESOURCE,
  ROUTE_TABLE_RESOURCE,
  ROUTE_RESOURCE,
  ROUTE_TABLE_ASSOCIATION_RESOURCE,
  MAIN_ROUTE_TABLE_ASSOCIATION_RESOURCE,
  NAT_GATEWAY_RESOURCE,
  INTERNET_GATEWAY_RESOURCE,
  EGRESS_ONLY_INTERNET_GATEWAY_RESOURCE,
  VPC_ENDPOINT_RESOURCE,
  LOAD_BALANCER_LISTENER_RESOURCE,
]);

const ensureVpcKeyFromIdentifier = (
  vpcIdentifier: string | undefined,
  context: PlacementContext,
  vpcKeys: Set<string>,
): void => {
  if (!vpcIdentifier) {
    return;
  }

  const existingVpcKey = context.vpcIdentifierToKey.get(vpcIdentifier);
  if (existingVpcKey) {
    vpcKeys.add(existingVpcKey);
    return;
  }

  context.vpcs.set(vpcIdentifier, {
    key: vpcIdentifier,
    label: vpcIdentifier,
  });
  context.vpcIdentifierToKey.set(vpcIdentifier, vpcIdentifier);
  vpcKeys.add(vpcIdentifier);
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
  const explicitVpcId = toStringValue(values.vpc_id);
  ensureVpcKeyFromIdentifier(explicitVpcId, context, vpcKeys);

  addSubnetIdentifiers(
    [
      ...toStringArray(values.subnets),
      ...toStringArray(values.subnet_ids),
      ...[toStringValue(values.subnet_id)].filter((entry): entry is string => entry !== undefined),
    ],
    context,
    subnetKeys,
    explicitVpcId,
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
  const stateId = toStringValue(values.id);
  const stateArn = toStringValue(values.arn);
  linkGroupIdentifier(groupMap, stateId, nodeId);
  linkGroupIdentifier(groupMap, stateArn, nodeId);
  linkGroupIdentifier(groupMap, toStringValue(values.name), nodeId);
  linkGroupIdentifier(groupMap, name, nodeId);
  linkGroupIdentifier(groupMap, address, nodeId);
  linkGroupIdentifier(groupMap, String(nodeId), nodeId);

  // Some resources resolve references via Terraform addresses in plan graphs.
  linkGroupIdentifier(groupMap, toStringValue(node.terraform?.address), nodeId);
};

export const NetworkPlacementEnricher: PlacementEnricher = {
  id: 'network',
  resources: NETWORK_PLACEMENT_RESOURCES,
  indexNode: ({ nodeId, node, values, context, resource, address, name }) => {
    if (!resource) {
      return;
    }

    const groupKind = INDEXED_GROUP_KIND_BY_RESOURCE[resource];
    if (!groupKind) {
      return;
    }

    linkNodeIdentifiers(groupKind, nodeId, node, values, context, address, name);
  },
  apply: ({ nodeId, values, context, subnetKeys, vpcKeys, explicitVpcId }) => {
    ensureVpcKeyFromIdentifier(explicitVpcId, context, vpcKeys);

    // Direct state references.
    ensureVpcKeyFromIdentifier(toStringValue(values.vpc_id), context, vpcKeys);
    addSubnetIdentifiers(
      [
        ...toStringArray(values.subnet_ids),
        ...[toStringValue(values.subnet_id)].filter(
          (entry): entry is string => entry !== undefined,
        ),
      ],
      context,
      subnetKeys,
      explicitVpcId ?? toStringValue(values.vpc_id),
    );

    // Indirect references to container resources.
    resolveFromGroupIdentifier(
      GROUP_KIND_SECURITY_GROUP,
      toStringValue(values.security_group_id),
      context,
      subnetKeys,
      vpcKeys,
    );
    resolveFromGroupIdentifier(
      GROUP_KIND_ROUTE_TABLE,
      toStringValue(values.route_table_id),
      context,
      subnetKeys,
      vpcKeys,
    );
    resolveFromGroupIdentifier(
      GROUP_KIND_NETWORK_ACL,
      toStringValue(values.network_acl_id),
      context,
      subnetKeys,
      vpcKeys,
    );
    resolveFromGroupIdentifier(
      GROUP_KIND_NAT_GATEWAY,
      toStringValue(values.nat_gateway_id),
      context,
      subnetKeys,
      vpcKeys,
    );
    resolveFromGroupIdentifier(
      GROUP_KIND_INTERNET_GATEWAY,
      toStringValue(values.gateway_id),
      context,
      subnetKeys,
      vpcKeys,
    );
    resolveFromGroupIdentifier(
      GROUP_KIND_VPC_ENDPOINT,
      toStringValue(values.vpc_endpoint_id),
      context,
      subnetKeys,
      vpcKeys,
    );
    resolveFromGroupIdentifier(
      GROUP_KIND_LOAD_BALANCER,
      toStringValue(values.load_balancer_arn) ?? toStringValue(values.load_balancer_id),
      context,
      subnetKeys,
      vpcKeys,
    );

    // Neighbor fallback for partial plans where ids are unknown but edges exist.
    const neighbors = new Set<NodeId>([
      ...context.graph.predecessors(nodeId),
      ...context.graph.successors(nodeId),
    ]);

    for (const neighborId of neighbors) {
      resolveVpcAndSubnetFromNode(neighborId, context, subnetKeys, vpcKeys);
    }
  },
};
