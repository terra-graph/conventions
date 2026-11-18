import {
  type AdapterOperations,
  type NodeId,
  NodeRule,
  type TgNodeAttributes,
} from '@terra-graph/core';

export class RemoveUninstantiatedResources extends NodeRule {
  public override apply(
    nodeId: NodeId,
    node: TgNodeAttributes,
    graph: AdapterOperations,
  ): AdapterOperations {
    if (!this.wasMatched(nodeId)) {
      return graph;
    }

    const terraform = node.terraform;
    const state = terraform?.state;
    if (
      !terraform ||
      (terraform.kind !== 'resource' && terraform.kind !== 'data') ||
      state?.source !== 'plan_show' ||
      state.effective !== null ||
      state.instances.length > 0
    ) {
      return graph;
    }

    // A separate change plan can supply evidence after plan decoration.
    const address = terraform.address;
    const changes = graph.toTgGraph().changes?.resources ?? {};
    const hasChange = Object.values(changes).some(
      (change) =>
        change.nodeId === nodeId ||
        (address !== undefined &&
          [change.address, change.previousAddress].some(
            (candidate) =>
              candidate !== undefined &&
              candidate.replace(/\[[^\]]+\]/g, '') === address.replace(/\[[^\]]+\]/g, ''),
          )),
    );
    return hasChange ? graph : graph.removeNode(nodeId);
  }
}

NodeRule.register(RemoveUninstantiatedResources);
