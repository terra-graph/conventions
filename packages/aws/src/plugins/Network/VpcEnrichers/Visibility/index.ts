import { type AdapterOperations, type NodeId, edgeIdFrom } from '@terra-graph/core';
import { toStringValue } from '../shared.js';
import type { AwsNetworkVisibilityMode } from '../types.js';

const TOPOLOGY_RESOURCES = new Set<string>(['aws_vpc', 'aws_subnet']);
const ARCHITECTURE_NOISE_RESOURCES = new Set<string>([
  'aws_vpc_security_group_ingress_rule',
  'aws_vpc_security_group_egress_rule',
  'aws_network_acl_rule',
  'aws_route_table_association',
  'aws_main_route_table_association',
]);

const MINIMAL_EXTRA_NOISE_RESOURCES = new Set<string>([
  'aws_route',
  'aws_route_table',
  'aws_network_acl',
]);

const shouldSuppressResourceForMode = (
  resource: string,
  mode: AwsNetworkVisibilityMode,
): boolean => {
  if (ARCHITECTURE_NOISE_RESOURCES.has(resource)) {
    return true;
  }

  if (mode === 'minimal' && MINIMAL_EXTRA_NOISE_RESOURCES.has(resource)) {
    return true;
  }

  return false;
};

const removeNodeAndReconnectEdges = (
  graph: AdapterOperations,
  nodeId: NodeId,
): AdapterOperations => {
  const inEdges = graph.inEdges(nodeId);
  const outEdges = graph.outEdges(nodeId);

  let updated = graph;

  if (outEdges.length > inEdges.length) {
    for (const inEdgeId of inEdges) {
      const sourceId = updated.edgeSource(inEdgeId);
      for (const outEdgeId of outEdges) {
        const targetId = updated.edgeTarget(outEdgeId);
        if (sourceId === targetId) {
          continue;
        }

        const edgeId = edgeIdFrom(
          sourceId,
          targetId,
          `aws.network.visibility.redirect:${String(nodeId)}:${String(inEdgeId)}:${String(outEdgeId)}`,
        );
        updated = updated.setEdge(edgeId, sourceId, targetId, {});
      }
    }
  } else {
    for (const outEdgeId of outEdges) {
      const targetId = updated.edgeTarget(outEdgeId);
      for (const inEdgeId of inEdges) {
        const sourceId = updated.edgeSource(inEdgeId);
        if (sourceId === targetId) {
          continue;
        }

        const edgeId = edgeIdFrom(
          sourceId,
          targetId,
          `aws.network.visibility.redirect:${String(nodeId)}:${String(inEdgeId)}:${String(outEdgeId)}`,
        );
        updated = updated.setEdge(edgeId, sourceId, targetId, {});
      }
    }
  }

  return updated.removeNode(nodeId);
};

const removeTopologyNodes = (graph: AdapterOperations): AdapterOperations => {
  let updated = graph;
  const nodeIds = [...graph.nodeIds()].sort((left, right) =>
    String(left).localeCompare(String(right)),
  );

  for (const nodeId of nodeIds) {
    const node = updated.getNodeAttributes(nodeId);
    if (!node) {
      continue;
    }

    const resource = toStringValue(node.terraform?.resource);
    if (!resource || !TOPOLOGY_RESOURCES.has(resource)) {
      continue;
    }

    updated = updated.removeNode(nodeId);
  }

  return updated;
};

export const applyAwsNetworkVisibilityMode = (
  graph: AdapterOperations,
  mode: AwsNetworkVisibilityMode,
): AdapterOperations => {
  if (mode === 'full') {
    return graph;
  }

  let updated = graph;
  const nodeIds = [...graph.nodeIds()].sort((left, right) =>
    String(left).localeCompare(String(right)),
  );

  for (const nodeId of nodeIds) {
    const node = updated.getNodeAttributes(nodeId);
    if (!node) {
      continue;
    }

    const resource = toStringValue(node.terraform?.resource);
    if (!resource || !shouldSuppressResourceForMode(resource, mode)) {
      continue;
    }

    updated = removeNodeAndReconnectEdges(updated, nodeId);
  }

  return updated;
};

export const applyAwsNetworkCleanup = (
  graph: AdapterOperations,
  mode: AwsNetworkVisibilityMode,
): AdapterOperations => {
  return applyAwsNetworkVisibilityMode(removeTopologyNodes(graph), mode);
};

export { ApplyAwsNetworkCleanup } from './ApplyAwsNetworkCleanup.js';
