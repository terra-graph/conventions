import {
  type AdapterOperations,
  type NodeId,
  NodeRule,
  type TgNodeAttributes,
} from '@terra-graph/core';
import { resolveAwsNetworkPlacementOptions } from '../index.js';
import { applyAwsNetworkCleanup } from './index.js';

export class ApplyAwsNetworkCleanup extends NodeRule {
  public override apply(
    nodeId: NodeId,
    _node: TgNodeAttributes,
    graph: AdapterOperations,
  ): AdapterOperations {
    if (!this.wasMatched(nodeId)) {
      return graph;
    }

    const firstNodeId = [...graph.nodeIds()]
      .map((id) => String(id))
      .sort((left, right) => left.localeCompare(right))[0];

    if (!firstNodeId || String(nodeId) !== firstNodeId) {
      return graph;
    }

    const placementOptions = resolveAwsNetworkPlacementOptions(this.config.options);
    return applyAwsNetworkCleanup(graph, placementOptions.mode);
  }
}

NodeRule.register(ApplyAwsNetworkCleanup);
