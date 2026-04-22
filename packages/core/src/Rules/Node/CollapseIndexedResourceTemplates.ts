import {
  type AdapterOperations,
  type NodeId,
  NodeRule,
  type TgNodeAttributes,
  edgeIdFrom,
} from '@terra-graph/core';

const INDEX_SUFFIX_PATTERN = /\[[^\]]+\]$/;

const hasIndexSuffix = (address: string): boolean => {
  return INDEX_SUFFIX_PATTERN.test(address);
};

export class CollapseIndexedResourceTemplates extends NodeRule {
  public override apply(
    nodeId: NodeId,
    node: TgNodeAttributes,
    graph: AdapterOperations,
  ): AdapterOperations {
    if (!this.wasMatched(nodeId)) {
      return graph;
    }

    if (node.terraform?.kind !== 'resource') {
      return graph;
    }

    const address = node.terraform.address;
    if (!address || hasIndexSuffix(address)) {
      return graph;
    }

    const hasIndexedInstances = graph.nodeIds().some((candidateNodeId) => {
      if (candidateNodeId === nodeId) {
        return false;
      }

      const candidateNode = graph.getNodeAttributes(candidateNodeId);
      if (candidateNode?.terraform?.kind !== 'resource') {
        return false;
      }

      const candidateAddress = candidateNode.terraform.address;
      if (!candidateAddress || !hasIndexSuffix(candidateAddress)) {
        return false;
      }

      return candidateAddress.startsWith(`${address}[`);
    });

    if (!hasIndexedInstances) {
      return graph;
    }

    const inEdges = graph.inEdges(nodeId);
    const outEdges = graph.outEdges(nodeId);
    let updated = graph;

    for (const inEdgeId of inEdges) {
      const sourceId = updated.edgeSource(inEdgeId);
      const inEdgeAttributes = updated.getEdgeAttributes(inEdgeId);

      for (const outEdgeId of outEdges) {
        const targetId = updated.edgeTarget(outEdgeId);
        const outEdgeAttributes = updated.getEdgeAttributes(outEdgeId);
        const redirectEdgeId = edgeIdFrom(
          sourceId,
          targetId,
          `collapse_indexed:${inEdgeId}:${outEdgeId}`,
        );

        updated = updated.setEdge(redirectEdgeId, sourceId, targetId, {
          ...inEdgeAttributes,
          ...outEdgeAttributes,
        });
      }
    }

    return updated.removeNode(nodeId);
  }
}

NodeRule.register(CollapseIndexedResourceTemplates);
