import {
  type AdapterOperations,
  ConvertNodeToEdge,
  GraphPlugin,
  type GraphPluginBuildInput,
  type GraphPluginBuildResult,
  isObjectRecord,
  type NamedPhase,
  type NodeId,
  NodeRule,
  RemoveNode,
  RemoveNodeAndReconnectEdges,
  type TgNodeAttributes,
  edgeIdFrom,
  tgNodeIdFrom,
} from '@terra-graph/core';
import { pluginId } from '../namespaces.js';

export const AWS_API_GATEWAY_PLUGIN_MODES = ['full', 'standard', 'minimal'] as const;

export type AwsApiGatewayPluginMode = (typeof AWS_API_GATEWAY_PLUGIN_MODES)[number];

export type AwsApiGatewayPluginOptions = {
  mode?: AwsApiGatewayPluginMode;
};

const API_CONTROL_PLANE_NOISE_V1_RESOURCES = [
  'aws_api_gateway_integration_response',
  'aws_api_gateway_method_response',
  'aws_api_gateway_method_settings',
  'aws_api_gateway_account',
  'aws_api_gateway_model',
  'aws_api_gateway_deployment',
];

const API_CONTROL_PLANE_NOISE_V2_RESOURCES = [
  'aws_apigatewayv2_integration_response',
  'aws_apigatewayv2_route_response',
  'aws_apigatewayv2_deployment',
];

const API_ROUTE_WRAPPER_STAGE_RESOURCES = ['aws_api_gateway_stage', 'aws_apigatewayv2_stage'];
const API_ROUTE_WRAPPER_MAPPING_RESOURCES = [
  'aws_api_gateway_base_path_mapping',
  'aws_apigatewayv2_api_mapping',
];

const API_ROUTE_WRAPPER_RESOURCES = [
  ...API_ROUTE_WRAPPER_STAGE_RESOURCES,
  ...API_ROUTE_WRAPPER_MAPPING_RESOURCES,
];
const API_RESOURCE = 'aws_apigatewayv2_api';
const ROUTE_RESOURCE = 'aws_apigatewayv2_route';
const INTEGRATION_RESOURCE = 'aws_apigatewayv2_integration';

type ResolvedAwsApiGatewayPluginOptions = {
  mode: AwsApiGatewayPluginMode;
};

type PluginPhases = NonNullable<GraphPluginBuildResult['phases']>;
type PluginRules = PluginPhases[number]['rules'];
type PluginRulePhases = PluginRules[];

const extractRouteKeyFromAddress = (address: string): string | undefined => {
  const bracketMatch = address.match(/\[(?:"([^"]+)"|'([^']+)')\]$/);
  if (!bracketMatch) {
    return undefined;
  }

  if (typeof bracketMatch[1] === 'string') {
    return bracketMatch[1].trim() || undefined;
  }
  if (typeof bracketMatch[2] === 'string') {
    return bracketMatch[2].trim() || undefined;
  }
  /* istanbul ignore next: regex guarantees one of the capture groups when matched */
  return undefined;
};

const normalizeRouteKey = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }

  const thisWrapperMatch = trimmed.match(/^this\[(?:"([^"]+)"|'([^']+)')\]$/);
  if (thisWrapperMatch) {
    if (typeof thisWrapperMatch[1] === 'string') {
      return thisWrapperMatch[1];
    }
    if (typeof thisWrapperMatch[2] === 'string') {
      return thisWrapperMatch[2];
    }
    /* istanbul ignore next: regex guarantees one of the capture groups when matched */
    return trimmed;
  }

  const quotedMatch = trimmed.match(/^(?:"([^"]+)"|'([^']+)')$/);
  if (quotedMatch) {
    if (typeof quotedMatch[1] === 'string') {
      return quotedMatch[1];
    }
    if (typeof quotedMatch[2] === 'string') {
      return quotedMatch[2];
    }
    /* istanbul ignore next: regex guarantees one of the capture groups when matched */
    return trimmed;
  }

  return trimmed;
};

const isSameModuleScope = (
  apiNode: TgNodeAttributes | undefined,
  routeNode: TgNodeAttributes | undefined,
): boolean => {
  const apiTerraform = apiNode?.terraform;
  const routeTerraform = routeNode?.terraform;
  if (!apiTerraform || !routeTerraform) {
    return true;
  }

  if (
    apiTerraform.moduleAddress &&
    routeTerraform.moduleAddress &&
    apiTerraform.moduleAddress !== routeTerraform.moduleAddress
  ) {
    return false;
  }

  if (
    apiTerraform.parentModuleNodeId &&
    routeTerraform.parentModuleNodeId &&
    apiTerraform.parentModuleNodeId !== routeTerraform.parentModuleNodeId
  ) {
    return false;
  }

  return true;
};

class NormalizeRestApiResourcePathToRoute extends NodeRule {
  constructor() {
    super({
      node: {
        attr: {
          key: 'terraform.resource',
          eq: 'aws_api_gateway_rest_api', // API node for REST v1
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

    const routePath = toRemove
      .map((resourceNodeId) => {
        const resourceNode = graph.getNodeAttributes(resourceNodeId);
        return resourceNode?.terraform?.name ?? String(resourceNodeId);
      })
      .join('/');
    const routeAddress = `aws_api_gateway_resource.${routePath}`;
    const routeNodeId = tgNodeIdFrom('resource', routeAddress);

    let updated = graph.setNodeAttributes(routeNodeId, {
      ...closestResourceNode,
      terraform: {
        ...closestResourceNode.terraform,
        kind: 'resource',
        address: routeAddress,
        resource: 'aws_api_gateway_resource',
        name: routePath,
      },
    });

    const outEdges = graph.outEdges(closestResourceNodeId);
    for (const outEdgeId of outEdges) {
      const targetId = graph.edgeTarget(outEdgeId);
      const edgeAttributes = graph.getEdgeAttributes(outEdgeId);
      const redirectedEdgeId = edgeIdFrom(
        routeNodeId,
        targetId,
        `apigateway:compress:out:${outEdgeId}`,
      );
      updated = updated.setEdge(redirectedEdgeId, routeNodeId, targetId, edgeAttributes);
    }

    const inEdges = graph.inEdges(furthestResourceNodeId);
    for (const inEdgeId of inEdges) {
      const sourceId = graph.edgeSource(inEdgeId);
      const edgeAttributes = graph.getEdgeAttributes(inEdgeId);
      const redirectedEdgeId = edgeIdFrom(
        sourceId,
        routeNodeId,
        `apigateway:compress:in:${inEdgeId}`,
      );
      updated = updated.setEdge(redirectedEdgeId, sourceId, routeNodeId, edgeAttributes);
    }

    for (const resourceNodeId of toRemove) {
      updated = updated.removeNode(resourceNodeId);
    }

    return updated;
  }
}

class NormalizeHttpApiRouteToRouteConcept extends NodeRule {
  constructor() {
    super({
      node: {
        attr: {
          key: 'terraform.resource',
          eq: 'aws_apigatewayv2_route', // Route node for HTTP/WebSocket v2
        },
      },
    });
  }

  public override apply(
    nodeId: NodeId,
    node: TgNodeAttributes,
    graph: AdapterOperations,
  ): AdapterOperations {
    if (!this.wasMatched(nodeId)) {
      return graph;
    }

    const terraform = node.terraform;
    if (!terraform) {
      return graph;
    }

    const terraformState = (terraform as Record<string, unknown>).state;
    const effectiveState = isObjectRecord(terraformState) ? terraformState.effective : undefined;
    const stateValues = isObjectRecord(effectiveState) ? effectiveState.values : undefined;
    const stateRouteKey = isObjectRecord(stateValues) ? stateValues.route_key : undefined;
    const routeKeyCandidate =
      (typeof stateRouteKey === 'string' && stateRouteKey) ||
      (typeof terraform.name === 'string' && terraform.name) ||
      (typeof terraform.address === 'string'
        ? extractRouteKeyFromAddress(terraform.address)
        : undefined);

    if (typeof routeKeyCandidate !== 'string') {
      return graph;
    }

    const normalizedRoute = normalizeRouteKey(routeKeyCandidate);
    if (!normalizedRoute || normalizedRoute === terraform.name) {
      return graph;
    }

    return graph.setNodeAttributes(nodeId, {
      ...node,
      terraform: {
        ...terraform,
        name: normalizedRoute,
      },
    });
  }
}

class RelinkHttpApiToRouteToIntegration extends NodeRule {
  constructor() {
    super({
      node: {
        attr: {
          key: 'terraform.resource',
          eq: API_RESOURCE, // API node for HTTP/WebSocket v2
        },
      },
    });
  }

  public override apply(
    nodeId: NodeId,
    node: TgNodeAttributes,
    graph: AdapterOperations,
  ): AdapterOperations {
    if (!this.wasMatched(nodeId)) {
      return graph;
    }

    const apiToIntegrationEdgeIds = graph.outEdges(nodeId).filter((edgeId) => {
      const targetId = graph.edgeTarget(edgeId);
      const targetNode = graph.getNodeAttributes(targetId);
      return targetNode?.terraform?.resource === INTEGRATION_RESOURCE;
    });

    const integrationToApiEdgeIds = graph.inEdges(nodeId).filter((edgeId) => {
      const sourceId = graph.edgeSource(edgeId);
      const sourceNode = graph.getNodeAttributes(sourceId);
      return sourceNode?.terraform?.resource === INTEGRATION_RESOURCE;
    });

    const apiIntegrationIds = new Set<NodeId>([
      ...apiToIntegrationEdgeIds.map((edgeId) => graph.edgeTarget(edgeId)),
      ...integrationToApiEdgeIds.map((edgeId) => graph.edgeSource(edgeId)),
    ]);

    if (apiIntegrationIds.size === 0) {
      return graph;
    }

    const integrationIdsLinkedViaRoute = new Set<NodeId>();
    let updated = graph;

    for (const routeId of graph.nodeIds()) {
      const routeNode = graph.getNodeAttributes(routeId);
      if (routeNode?.terraform?.resource !== ROUTE_RESOURCE) {
        continue;
      }
      if (!isSameModuleScope(node, routeNode)) {
        continue;
      }

      const routeToIntegrationIds = graph
        .outEdges(routeId)
        .map((edgeId) => graph.edgeTarget(edgeId))
        .filter((targetId) => {
          if (!apiIntegrationIds.has(targetId)) {
            return false;
          }
          const targetNode = graph.getNodeAttributes(targetId);
          return targetNode?.terraform?.resource === INTEGRATION_RESOURCE;
        });

      const integrationToRouteIds = graph
        .inEdges(routeId)
        .map((edgeId) => graph.edgeSource(edgeId))
        .filter((sourceId) => {
          if (!apiIntegrationIds.has(sourceId)) {
            return false;
          }
          const sourceNode = graph.getNodeAttributes(sourceId);
          return sourceNode?.terraform?.resource === INTEGRATION_RESOURCE;
        });

      const routeIntegrationIds = [...routeToIntegrationIds, ...integrationToRouteIds];
      const hasApiRouteEdge = graph.edgesBetween(nodeId, routeId).length > 0;

      if (routeIntegrationIds.length === 0 && !hasApiRouteEdge) {
        continue;
      }

      if (updated.edgesBetween(nodeId, routeId).length === 0) {
        const edgeId = edgeIdFrom(nodeId, routeId, `apigateway:model:api-route:${routeId}`);
        updated = updated.setEdge(edgeId, nodeId, routeId, {});
      }

      for (const integrationId of routeIntegrationIds) {
        integrationIdsLinkedViaRoute.add(integrationId);
      }
    }

    if (integrationIdsLinkedViaRoute.size === 0) {
      return updated;
    }

    for (const edgeId of apiToIntegrationEdgeIds) {
      const integrationId = graph.edgeTarget(edgeId);
      if (!integrationIdsLinkedViaRoute.has(integrationId)) {
        continue;
      }
      if (updated.outEdges(nodeId).includes(edgeId)) {
        updated = updated.removeEdge(edgeId);
      }
    }

    for (const edgeId of integrationToApiEdgeIds) {
      const integrationId = graph.edgeSource(edgeId);
      if (!integrationIdsLinkedViaRoute.has(integrationId)) {
        continue;
      }
      if (updated.inEdges(nodeId).includes(edgeId)) {
        updated = updated.removeEdge(edgeId);
      }
    }

    return updated;
  }
}

export class ApiGatewayPlugin extends GraphPlugin<AwsApiGatewayPluginOptions> {
  static id = pluginId(`aws.${ApiGatewayPlugin.name}`);

  constructor() {
    super(ApiGatewayPlugin.id, {
      mode: 'standard',
    });
  }

  public override build({
    options,
  }: GraphPluginBuildInput<AwsApiGatewayPluginOptions>): GraphPluginBuildResult {
    const resolved = this.resolveOptions(options);
    const phases: PluginPhases = [
      ...this.toPhases('main', [
        [
          new NormalizeRestApiResourcePathToRoute(),
          new NormalizeHttpApiRouteToRouteConcept(),
          new RelinkHttpApiToRouteToIntegration(),
        ],
      ]),
    ];

    if (resolved.mode !== 'full') {
      phases.push(
        ...this.toPhases('main', [
          [
            new RemoveNode({
              node: {
                attr: {
                  key: 'terraform.resource',
                  in: [
                    ...API_CONTROL_PLANE_NOISE_V1_RESOURCES,
                    ...API_CONTROL_PLANE_NOISE_V2_RESOURCES,
                  ],
                },
              },
            }),
          ],
        ]),
      );
    }

    if (resolved.mode === 'minimal') {
      phases.push(
        ...this.toPhases('main', [
          [
            new ConvertNodeToEdge({
              node: {
                attr: {
                  key: 'terraform.resource',
                  in: API_ROUTE_WRAPPER_RESOURCES,
                },
              },
            }),
          ],
          [
            new RemoveNodeAndReconnectEdges({
              node: {
                attr: {
                  key: 'terraform.resource',
                  in: API_ROUTE_WRAPPER_RESOURCES,
                },
              },
            }),
          ],
        ]),
      );
    }

    return { phases };
  }

  private toPhases(phase: NamedPhase, phases: PluginRulePhases): PluginPhases {
    return phases.map((rules) => ({ phase, rules }));
  }

  private isEnumValue<T extends readonly string[]>(value: unknown, values: T): value is T[number] {
    return typeof value === 'string' && values.includes(value);
  }

  private resolveOptions(options: AwsApiGatewayPluginOptions): ResolvedAwsApiGatewayPluginOptions {
    const mode = options.mode ?? 'standard';

    if (!this.isEnumValue(mode, AWS_API_GATEWAY_PLUGIN_MODES)) {
      throw new Error(
        `${this.name} options.mode must be one of: ${AWS_API_GATEWAY_PLUGIN_MODES.join(', ')}`,
      );
    }

    return {
      mode,
    };
  }
}

NodeRule.register(NormalizeRestApiResourcePathToRoute);
NodeRule.register(NormalizeHttpApiRouteToRouteConcept);
NodeRule.register(RelinkHttpApiToRouteToIntegration);
