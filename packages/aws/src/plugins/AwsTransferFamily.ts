import {
  type AdapterOperations,
  GraphPlugin,
  type GraphPluginBuildInput,
  type GraphPluginBuildResult,
  type NodeId,
  NodeRule,
  RemoveNode,
  type TgNodeAttributes,
  edgeIdFrom,
  tgNodeIdFrom,
} from '@terra-graph/core';
import { pluginId } from '../namespaces.js';

const DEFAULT_EVENT_BUS_ADDRESS = 'aws_cloudwatch_event_bus.default';
const DEFAULT_EVENT_BUS_NODE_ID = tgNodeIdFrom('resource', DEFAULT_EVENT_BUS_ADDRESS);

const ensureDefaultEventBus = (graph: AdapterOperations): AdapterOperations => {
  return graph.setNodeAttributes(DEFAULT_EVENT_BUS_NODE_ID, {
    terraform: {
      kind: 'resource',
      address: DEFAULT_EVENT_BUS_ADDRESS,
      resource: 'aws_cloudwatch_event_bus',
      name: 'default',
    },
  });
};

class ConnectTransferConnectorToDefaultEventBus extends NodeRule {
  constructor() {
    super({
      node: {
        attr: {
          key: 'terraform.resource',
          eq: 'aws_transfer_connector',
        },
      },
    });
  }

  public override apply(
    nodeId: NodeId,
    _node: TgNodeAttributes,
    graph: AdapterOperations,
  ): AdapterOperations {
    if (!this.wasMatched(nodeId)) {
      return graph;
    }

    const updated = ensureDefaultEventBus(graph);
    return updated.setEdge(
      edgeIdFrom(nodeId, DEFAULT_EVENT_BUS_NODE_ID, 'transfer:connector-bus'),
      nodeId,
      DEFAULT_EVENT_BUS_NODE_ID,
      {},
    );
  }
}

class RewireTransferEventRuleToDefaultEventBus extends NodeRule {
  constructor() {
    super({
      node: {
        attr: {
          key: 'terraform.resource',
          eq: 'aws_cloudwatch_event_rule',
        },
      },
    });
  }

  public override apply(
    nodeId: NodeId,
    _node: TgNodeAttributes,
    graph: AdapterOperations,
  ): AdapterOperations {
    if (!this.wasMatched(nodeId)) {
      return graph;
    }

    const outEdges = graph.outEdges(nodeId);
    let updated = ensureDefaultEventBus(graph);

    if (outEdges.length === 0) {
      return updated.setEdge(
        edgeIdFrom(DEFAULT_EVENT_BUS_NODE_ID, nodeId, 'transfer:rule-bus'),
        DEFAULT_EVENT_BUS_NODE_ID,
        nodeId,
        {},
      );
    }

    let didRewire = false;
    for (const outEdgeId of outEdges) {
      const targetNodeId = graph.edgeTarget(outEdgeId);
      const targetNode = graph.getNodeAttributes(targetNodeId);
      if (targetNode?.terraform?.resource !== 'aws_transfer_connector') {
        continue;
      }

      updated = updated.removeEdge(outEdgeId);
      didRewire = true;
    }

    if (!didRewire) {
      return updated;
    }

    return updated.setEdge(
      edgeIdFrom(DEFAULT_EVENT_BUS_NODE_ID, nodeId, 'transfer:rule-bus'),
      DEFAULT_EVENT_BUS_NODE_ID,
      nodeId,
      {},
    );
  }
}

export class AwsTransferFamily extends GraphPlugin {
  static id = pluginId(`aws.${AwsTransferFamily.name}`);

  constructor() {
    super(AwsTransferFamily.id);
  }

  public override build(_input: GraphPluginBuildInput): GraphPluginBuildResult {
    return {
      phases: [
        {
          phase: 'main',
          rules: [
            new RemoveNode({
              node: {
                attr: {
                  key: 'terraform.resource',
                  eq: 'aws_transfer_tag',
                },
              },
            }),
          ],
        },
        {
          phase: 'main',
          rules: [
            new ConnectTransferConnectorToDefaultEventBus(),
            new RewireTransferEventRuleToDefaultEventBus(),
          ],
        },
      ],
    };
  }
}
