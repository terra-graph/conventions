import {
  type AdapterOperations,
  type BaseRule,
  type GraphPluginBuildInput,
  GraphologyAdapter,
  type NamedPhase,
  NamedRuleRegistry,
  NamedRuleSetRegistry,
  type SerializedRule,
  TG_SCHEMA_VERSION,
  type TgGraph,
  asEdgeId,
  asNodeId,
  tgNodeIdFrom,
} from '@terra-graph/core';
import { AwsApiGateway } from './AwsApiGateway.js';
import type { AwsApiGatewayPluginOptions } from './AwsApiGateway.js';

type SerializedPhaseStep = {
  phase: NamedPhase;
  rules: SerializedRule[];
};

const buildPhases = (options: AwsApiGatewayPluginOptions = {}): SerializedPhaseStep[] => {
  const plugin = new AwsApiGateway();
  const result = plugin.build({
    options,
    namedRules: new NamedRuleRegistry(),
    namedRuleSets: new NamedRuleSetRegistry(),
  } as GraphPluginBuildInput<AwsApiGatewayPluginOptions>);

  return (result.phases ?? []).map((phase) => ({
    phase: phase.phase,
    rules: phase.rules.map((rule) => (rule as BaseRule).serialize()),
  }));
};

const buildRules = (options: AwsApiGatewayPluginOptions = {}): BaseRule[] => {
  const plugin = new AwsApiGateway();
  const result = plugin.build({
    options,
    namedRules: new NamedRuleRegistry(),
    namedRuleSets: new NamedRuleSetRegistry(),
  } as GraphPluginBuildInput<AwsApiGatewayPluginOptions>);

  return (result.phases ?? []).flatMap((phase) => phase.rules as BaseRule[]);
};

const buildAdapter = (graph: TgGraph): AdapterOperations => {
  return new GraphologyAdapter().withTgGraph(graph);
};

describe('AwsApiGateway.build', () => {
  it('shoud default to standard mode', () => {
    const phases = buildPhases();

    expect(phases).toHaveLength(2);
    expect(phases.map((phase) => phase.phase)).toStrictEqual(['main', 'main']);
    expect(phases[0]?.rules.map((rule) => rule.id)).toStrictEqual([
      'NormalizeRestApiResourcePathToRoute',
      'NormalizeHttpApiRouteToRouteConcept',
      'RelinkHttpApiToRouteToIntegration',
    ]);
    expect(phases[1]?.rules[0]).toStrictEqual({
      id: 'RemoveNode',
      config: {
        node: {
          attr: {
            key: 'terraform.resource',
            in: [
              'aws_api_gateway_integration_response',
              'aws_api_gateway_method_response',
              'aws_api_gateway_method_settings',
              'aws_api_gateway_account',
              'aws_api_gateway_model',
              'aws_api_gateway_deployment',
              'aws_apigatewayv2_integration_response',
              'aws_apigatewayv2_route_response',
              'aws_apigatewayv2_deployment',
            ],
          },
        },
      },
    });
  });

  it('shoud build full mode without removals', () => {
    const phases = buildPhases({ mode: 'full' });

    expect(phases).toHaveLength(1);
    expect(phases[0]?.phase).toBe('main');
    expect(phases[0]?.rules.map((rule) => rule.id)).toStrictEqual([
      'NormalizeRestApiResourcePathToRoute',
      'NormalizeHttpApiRouteToRouteConcept',
      'RelinkHttpApiToRouteToIntegration',
    ]);
  });

  it('shoud build minimal mode with stage and mapping collapse steps', () => {
    const phases = buildPhases({ mode: 'minimal' });

    expect(phases.map((phase) => phase.rules[0]?.id)).toStrictEqual([
      'NormalizeRestApiResourcePathToRoute',
      'RemoveNode',
      'ConvertNodeToEdge',
      'RemoveNodeAndReconnectEdges',
    ]);
    expect(phases[2]?.rules[0]).toStrictEqual({
      id: 'ConvertNodeToEdge',
      config: {
        node: {
          attr: {
            key: 'terraform.resource',
            in: [
              'aws_api_gateway_stage',
              'aws_apigatewayv2_stage',
              'aws_api_gateway_base_path_mapping',
              'aws_apigatewayv2_api_mapping',
            ],
          },
        },
      },
    });
    expect(phases[3]?.rules[0]).toStrictEqual({
      id: 'RemoveNodeAndReconnectEdges',
      config: {
        node: {
          attr: {
            key: 'terraform.resource',
            in: [
              'aws_api_gateway_stage',
              'aws_apigatewayv2_stage',
              'aws_api_gateway_base_path_mapping',
              'aws_apigatewayv2_api_mapping',
            ],
          },
        },
      },
    });
  });

  it('shoud throw for invalid mode', () => {
    const plugin = new AwsApiGateway();
    expect(() =>
      plugin.build({
        options: { mode: 'invalid' } as unknown as AwsApiGatewayPluginOptions,
        namedRules: new NamedRuleRegistry(),
        namedRuleSets: new NamedRuleSetRegistry(),
      } as GraphPluginBuildInput<AwsApiGatewayPluginOptions>),
    ).toThrow(`${AwsApiGateway.id} options.mode must be one of: full, standard, minimal`);
  });

  it('shoud collapse chained REST resource nodes into a compressed path node', () => {
    const restApiId = asNodeId('resource.aws_api_gateway_rest_api.my_api');
    const resourceParentId = asNodeId('resource.aws_api_gateway_resource.api');
    const resourceChildId = asNodeId('resource.aws_api_gateway_resource.users');
    const rootId = asNodeId('resource.other.parent');
    const methodNodeId = asNodeId('resource.aws_api_gateway_method.get_user');
    const expectedCompressedId = tgNodeIdFrom('resource', 'aws_api_gateway_resource.users/api');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [restApiId]: {
          id: restApiId,
          label: 'api',
          terraform: {
            kind: 'resource',
            address: 'aws_api_gateway_rest_api.my_api',
            resource: 'aws_api_gateway_rest_api',
            name: 'my_api',
          },
        },
        [resourceChildId]: {
          id: resourceChildId,
          label: 'users',
          terraform: {
            kind: 'resource',
            address: 'aws_api_gateway_resource.users',
            resource: 'aws_api_gateway_resource',
            name: 'users',
          },
        },
        [resourceParentId]: {
          id: resourceParentId,
          label: 'api',
          terraform: {
            kind: 'resource',
            address: 'aws_api_gateway_resource.api',
            resource: 'aws_api_gateway_resource',
            name: 'api',
          },
        },
        [rootId]: {
          id: rootId,
          label: 'parent',
          terraform: {
            kind: 'resource',
            address: 'resource.other.parent',
            resource: 'aws_vpc',
            name: 'parent',
          },
        },
        [methodNodeId]: {
          id: methodNodeId,
          label: 'method',
          terraform: {
            kind: 'resource',
            address: 'aws_api_gateway_method.get_user',
            resource: 'aws_api_gateway_method',
            name: 'get_user',
          },
        },
      },
      edges: [
        {
          id: asEdgeId('edge-root-child'),
          from: rootId,
          to: resourceParentId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-parent-child'),
          from: resourceParentId,
          to: resourceChildId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-child-api'),
          from: resourceChildId,
          to: restApiId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-child-method'),
          from: resourceChildId,
          to: methodNodeId,
          attributes: {},
        },
      ],
    });

    const compressRule = buildRules().find(
      (rule) => rule.serialize().id === 'NormalizeRestApiResourcePathToRoute',
    );
    if (!compressRule) {
      throw new Error('Missing NormalizeRestApiResourcePathToRoute');
    }

    const restNode = adapter.getNodeAttributes(restApiId);
    if (!restNode) {
      throw new Error('Missing API gateway rest api node');
    }

    compressRule.match(restApiId, restNode, adapter);
    const updated = compressRule.apply(restApiId, restNode, adapter);

    expect(updated).not.toBe(adapter);
    expect(updated.nodeIds()).toContain(expectedCompressedId);
    expect(updated.nodeIds()).not.toContain(resourceChildId);
    expect(updated.nodeIds()).not.toContain(resourceParentId);
    expect(updated.edgesBetween(rootId, expectedCompressedId)).toHaveLength(1);
    expect(updated.edgesBetween(expectedCompressedId, methodNodeId)).toHaveLength(1);
    expect(updated.edgesBetween(expectedCompressedId, restApiId)).toHaveLength(1);
  });

  it('shoud let reconnect fallback handle fan-out when convert-to-edge no-ops', () => {
    const sourceId = asNodeId('resource.aws_apigatewayv2_api.http');
    const stageId = asNodeId('resource.aws_apigatewayv2_stage.default');
    const targetAId = asNodeId('resource.aws_lambda_function.a');
    const targetBId = asNodeId('resource.aws_lambda_function.b');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [sourceId]: {
          id: sourceId,
          label: 'http',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_api.http',
            resource: 'aws_apigatewayv2_api',
            name: 'http',
          },
        },
        [stageId]: {
          id: stageId,
          label: 'default',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_stage.default',
            resource: 'aws_apigatewayv2_stage',
            name: 'default',
          },
        },
        [targetAId]: {
          id: targetAId,
          label: 'a',
          terraform: {
            kind: 'resource',
            address: 'aws_lambda_function.a',
            resource: 'aws_lambda_function',
            name: 'a',
          },
        },
        [targetBId]: {
          id: targetBId,
          label: 'b',
          terraform: {
            kind: 'resource',
            address: 'aws_lambda_function.b',
            resource: 'aws_lambda_function',
            name: 'b',
          },
        },
      },
      edges: [
        { id: asEdgeId('edge-api-stage'), from: sourceId, to: stageId, attributes: {} },
        { id: asEdgeId('edge-stage-a'), from: stageId, to: targetAId, attributes: {} },
        { id: asEdgeId('edge-stage-b'), from: stageId, to: targetBId, attributes: {} },
      ],
    });

    const rules = buildRules({ mode: 'minimal' });
    const convertRule = rules.find((rule) => rule.serialize().id === 'ConvertNodeToEdge');
    const reconnectRule = rules.find(
      (rule) => rule.serialize().id === 'RemoveNodeAndReconnectEdges',
    );

    if (!convertRule || !reconnectRule) {
      throw new Error('Missing minimal mode conversion rules');
    }

    const stageNode = adapter.getNodeAttributes(stageId);
    if (!stageNode) {
      throw new Error('Missing API gateway stage node');
    }

    convertRule.match(stageId, stageNode, adapter);
    const afterConvert = convertRule.apply(stageId, stageNode, adapter);
    expect(afterConvert).toBe(adapter);
    expect(afterConvert.nodeIds()).toContain(stageId);

    reconnectRule.match(stageId, stageNode, afterConvert);
    const afterReconnect = reconnectRule.apply(stageId, stageNode, afterConvert);
    expect(afterReconnect).not.toBe(adapter);
    expect(afterReconnect.nodeIds()).not.toContain(stageId);
    expect(afterReconnect.edgesBetween(sourceId, targetAId)).toHaveLength(1);
    expect(afterReconnect.edgesBetween(sourceId, targetBId)).toHaveLength(1);
  });

  it('shoud normalize v2 route node names into API route keys', () => {
    const routeId = asNodeId('resource.aws_apigatewayv2_route.this["GET /orders/{id}"]');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [routeId]: {
          id: routeId,
          label: 'route',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_route.this["GET /orders/{id}"]',
            resource: 'aws_apigatewayv2_route',
            name: 'this["GET /orders/{id}"]',
          },
        },
      },
      edges: [],
    });

    const normalizeRule = buildRules().find(
      (rule) => rule.serialize().id === 'NormalizeHttpApiRouteToRouteConcept',
    );
    if (!normalizeRule) {
      throw new Error('Missing NormalizeHttpApiRouteToRouteConcept');
    }

    const routeNode = adapter.getNodeAttributes(routeId);
    if (!routeNode) {
      throw new Error('Missing API gateway route node');
    }

    normalizeRule.match(routeId, routeNode, adapter);
    const updated = normalizeRule.apply(routeId, routeNode, adapter);
    expect(updated.getNodeAttributes(routeId)?.terraform?.name).toBe('GET /orders/{id}');
  });

  it('shoud relink v2 HTTP API edges to API -> Route -> Integration in all modes', () => {
    const apiId = asNodeId('resource.aws_apigatewayv2_api.http');
    const routeId = asNodeId('resource.aws_apigatewayv2_route.get_orders');
    const integrationAId = asNodeId('resource.aws_apigatewayv2_integration.orders');
    const integrationBId = asNodeId('resource.aws_apigatewayv2_integration.health');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [apiId]: {
          id: apiId,
          label: 'http',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_api.http',
            resource: 'aws_apigatewayv2_api',
            name: 'http',
          },
        },
        [routeId]: {
          id: routeId,
          label: 'GET /orders',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_route.get_orders',
            resource: 'aws_apigatewayv2_route',
            name: 'GET /orders',
          },
        },
        [integrationAId]: {
          id: integrationAId,
          label: 'orders',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_integration.orders',
            resource: 'aws_apigatewayv2_integration',
            name: 'orders',
          },
        },
        [integrationBId]: {
          id: integrationBId,
          label: 'health',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_integration.health',
            resource: 'aws_apigatewayv2_integration',
            name: 'health',
          },
        },
      },
      edges: [
        {
          id: asEdgeId('edge-api-to-orders-integration'),
          from: apiId,
          to: integrationAId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-api-to-health-integration'),
          from: apiId,
          to: integrationBId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-route-to-orders-integration'),
          from: routeId,
          to: integrationAId,
          attributes: {},
        },
      ],
    });

    const relinkRule = buildRules({ mode: 'full' }).find(
      (rule) => rule.serialize().id === 'RelinkHttpApiToRouteToIntegration',
    );
    if (!relinkRule) {
      throw new Error('Missing RelinkHttpApiToRouteToIntegration');
    }

    const apiNode = adapter.getNodeAttributes(apiId);
    if (!apiNode) {
      throw new Error('Missing API gateway API node');
    }

    relinkRule.match(apiId, apiNode, adapter);
    const updated = relinkRule.apply(apiId, apiNode, adapter);

    expect(updated).not.toBe(adapter);
    expect(updated.edgesBetween(apiId, routeId)).toHaveLength(1);
    expect(updated.edgesBetween(apiId, integrationAId)).toHaveLength(0);
    expect(updated.edgesBetween(apiId, integrationBId)).toHaveLength(1);
  });

  it('shoud relink when terraform edges are integration -> api', () => {
    const apiId = asNodeId('resource.aws_apigatewayv2_api.http');
    const routeId = asNodeId('resource.aws_apigatewayv2_route.get_orders');
    const integrationAId = asNodeId('resource.aws_apigatewayv2_integration.orders');
    const integrationBId = asNodeId('resource.aws_apigatewayv2_integration.health');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [apiId]: {
          id: apiId,
          label: 'http',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_api.http',
            resource: 'aws_apigatewayv2_api',
            name: 'http',
          },
        },
        [routeId]: {
          id: routeId,
          label: 'GET /orders',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_route.get_orders',
            resource: 'aws_apigatewayv2_route',
            name: 'GET /orders',
          },
        },
        [integrationAId]: {
          id: integrationAId,
          label: 'orders',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_integration.orders',
            resource: 'aws_apigatewayv2_integration',
            name: 'orders',
          },
        },
        [integrationBId]: {
          id: integrationBId,
          label: 'health',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_integration.health',
            resource: 'aws_apigatewayv2_integration',
            name: 'health',
          },
        },
      },
      edges: [
        {
          id: asEdgeId('edge-orders-integration-to-api'),
          from: integrationAId,
          to: apiId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-health-integration-to-api'),
          from: integrationBId,
          to: apiId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-route-to-orders-integration'),
          from: routeId,
          to: integrationAId,
          attributes: {},
        },
      ],
    });

    const relinkRule = buildRules({ mode: 'standard' }).find(
      (rule) => rule.serialize().id === 'RelinkHttpApiToRouteToIntegration',
    );
    if (!relinkRule) {
      throw new Error('Missing RelinkHttpApiToRouteToIntegration');
    }

    const apiNode = adapter.getNodeAttributes(apiId);
    if (!apiNode) {
      throw new Error('Missing API gateway API node');
    }

    relinkRule.match(apiId, apiNode, adapter);
    const updated = relinkRule.apply(apiId, apiNode, adapter);

    expect(updated).not.toBe(adapter);
    expect(updated.edgesBetween(apiId, routeId)).toHaveLength(1);
    expect(updated.edgesBetween(apiId, integrationAId)).toHaveLength(0);
    expect(updated.edgesBetween(apiId, integrationBId)).toHaveLength(1);
  });
});
