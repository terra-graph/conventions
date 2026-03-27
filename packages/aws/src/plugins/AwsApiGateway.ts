import {
  type AdapterOperations,
  ConvertNodeToEdge,
  EdgeReverse,
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

class CompressApiGatewayResourcePath extends NodeRule {
  constructor() {
    super({
      node: {
        attr: {
          key: 'terraform.resource',
          eq: 'aws_api_gateway_rest_api',
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

    const toRemove: NodeId[] = [];
    const collect = (currentNodeId: NodeId) => {
      const previous = graph.predecessors(currentNodeId);
      if (previous.length !== 1) {
        return;
      }

      const previousNodeId = previous[0];
      const previousNode = graph.getNodeAttributes(previousNodeId);
      if (previousNode?.terraform?.resource !== 'aws_api_gateway_resource') {
        return;
      }

      toRemove.push(previousNodeId);
      collect(previousNodeId);
    };

    collect(nodeId);

    if (toRemove.length === 0) {
      return graph;
    }

    const closestResourceNodeId = toRemove[0];
    const furthestResourceNodeId = toRemove[toRemove.length - 1];
    const closestResourceNode = graph.getNodeAttributes(closestResourceNodeId);
    if (!closestResourceNode) {
      return graph;
    }

    const resourcePath = toRemove
      .map((resourceNodeId) => {
        const resourceNode = graph.getNodeAttributes(resourceNodeId);
        return resourceNode?.terraform?.name ?? String(resourceNodeId);
      })
      .join('/');
    const resourceAddress = `aws_api_gateway_resource.${resourcePath}`;
    const compressedNodeId = tgNodeIdFrom('resource', resourceAddress);

    let updated = graph.setNodeAttributes(compressedNodeId, {
      ...closestResourceNode,
      terraform: {
        ...closestResourceNode.terraform,
        kind: 'resource',
        address: resourceAddress,
        resource: 'aws_api_gateway_resource',
        name: resourcePath,
      },
    });

    const outEdges = graph.outEdges(closestResourceNodeId);
    for (const outEdgeId of outEdges) {
      const targetId = graph.edgeTarget(outEdgeId);
      const edgeAttributes = graph.getEdgeAttributes(outEdgeId);
      const redirectedEdgeId = edgeIdFrom(
        compressedNodeId,
        targetId,
        `apigateway:compress:out:${outEdgeId}`,
      );
      updated = updated.setEdge(redirectedEdgeId, compressedNodeId, targetId, edgeAttributes);
    }

    const inEdges = graph.inEdges(furthestResourceNodeId);
    for (const inEdgeId of inEdges) {
      const sourceId = graph.edgeSource(inEdgeId);
      const edgeAttributes = graph.getEdgeAttributes(inEdgeId);
      const redirectedEdgeId = edgeIdFrom(
        sourceId,
        compressedNodeId,
        `apigateway:compress:in:${inEdgeId}`,
      );
      updated = updated.setEdge(redirectedEdgeId, sourceId, compressedNodeId, edgeAttributes);
    }

    for (const resourceNodeId of toRemove) {
      updated = updated.removeNode(resourceNodeId);
    }

    return updated;
  }
}

export class AwsApiGateway extends GraphPlugin {
  static id = pluginId(`aws.${AwsApiGateway.name}`);

  constructor() {
    super(AwsApiGateway.id);
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
                  in: [
                    'aws_api_gateway_integration_response',
                    'aws_api_gateway_method_response',
                    'aws_api_gateway_method_settings',
                    'aws_api_gateway_account',
                    'aws_api_gateway_model',
                    'aws_wafv2_web_acl_logging_configuration',
                  ],
                },
              },
            }),
          ],
        },
        { phase: 'main', rules: [new CompressApiGatewayResourcePath()] },
        {
          phase: 'main',
          rules: [
            new EdgeReverse({
              edge: {
                from: {
                  attr: {
                    key: 'terraform.resource',
                    eq: 'aws_api_gateway_rest_api',
                  },
                },
                to: {
                  attr: {
                    key: 'terraform.resource',
                    eq: 'aws_api_gateway_resource',
                  },
                },
              },
            }),
            new EdgeReverse({
              edge: {
                from: {
                  attr: {
                    key: 'terraform.resource',
                    eq: 'aws_api_gateway_method',
                  },
                },
                to: {
                  attr: {
                    key: 'terraform.resource',
                    eq: 'aws_api_gateway_integration',
                  },
                },
              },
            }),
            new EdgeReverse({
              edge: {
                from: {
                  attr: {
                    key: 'terraform.resource',
                    eq: 'aws_api_gateway_resource',
                  },
                },
                to: {
                  attr: {
                    key: 'terraform.resource',
                    eq: 'aws_api_gateway_method',
                  },
                },
              },
            }),
            new EdgeReverse({
              edge: {
                from: {
                  attr: {
                    key: 'terraform.resource',
                    eq: 'aws_wafv2_web_acl',
                  },
                },
                to: {
                  attr: {
                    key: 'terraform.resource',
                    eq: 'aws_wafv2_web_acl_association',
                  },
                },
              },
            }),
            new EdgeReverse({
              edge: {
                from: {
                  attr: {
                    key: 'terraform.resource',
                    eq: 'aws_wafv2_ip_set',
                  },
                },
                to: {
                  attr: {
                    key: 'terraform.resource',
                    eq: 'aws_wafv2_web_acl',
                  },
                },
              },
            }),
          ],
        },
        {
          phase: 'main',
          rules: [
            new ConvertNodeToEdge({
              node: {
                attr: {
                  key: 'terraform.resource',
                  in: [
                    'aws_api_gateway_deployment',
                    'aws_api_gateway_method',
                    'aws_wafv2_web_acl_association',
                  ],
                },
              },
            }),
          ],
        },
      ],
    };
  }
}
