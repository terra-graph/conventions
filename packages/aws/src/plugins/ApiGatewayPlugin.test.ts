import {
  type AdapterOperations,
  type BaseRule,
  type GraphPluginBuildInput,
  GraphologyAdapter,
  type NamedPhase,
  NamedRuleRegistry,
  NamedRuleSetRegistry,
  type NodeId,
  type SerializedRule,
  TG_SCHEMA_VERSION,
  type TgGraph,
  type TgNode,
  type TgNodeTerraformState,
  asEdgeId,
  asNodeId,
  tgNodeIdFrom,
} from '@terra-graph/core';
import { ApiGatewayPlugin } from './ApiGatewayPlugin.js';
import type { AwsApiGatewayPluginOptions } from './ApiGatewayPlugin.js';

type SerializedPhaseStep = {
  phase: NamedPhase;
  rules: SerializedRule[];
};

const buildPhases = (options: AwsApiGatewayPluginOptions = {}): SerializedPhaseStep[] => {
  const plugin = new ApiGatewayPlugin();
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
  const plugin = new ApiGatewayPlugin();
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
    const plugin = new ApiGatewayPlugin();
    expect(() =>
      plugin.build({
        options: { mode: 'invalid' } as unknown as AwsApiGatewayPluginOptions,
        namedRules: new NamedRuleRegistry(),
        namedRuleSets: new NamedRuleSetRegistry(),
      } as GraphPluginBuildInput<AwsApiGatewayPluginOptions>),
    ).toThrow(`${ApiGatewayPlugin.id} options.mode must be one of: full, standard, minimal`);
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
        {
          id: asEdgeId('edge-api-stage'),
          from: sourceId,
          to: stageId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-stage-a'),
          from: stageId,
          to: targetAId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-stage-b'),
          from: stageId,
          to: targetBId,
          attributes: {},
        },
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

  it('shoud extract route keys from route addresses when name is missing', () => {
    const routeId = asNodeId('resource.aws_apigatewayv2_route.this["GET /orders"]');
    const doubleQuotedRouteId = asNodeId('resource.aws_apigatewayv2_route.this["GET /invoices"]');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [routeId]: {
          id: routeId,
          label: 'route',
          terraform: {
            kind: 'resource',
            address: "aws_apigatewayv2_route.this[' GET /orders ']",
            resource: 'aws_apigatewayv2_route',
          },
        },
        [doubleQuotedRouteId]: {
          id: doubleQuotedRouteId,
          label: 'route',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_route.this["GET /invoices"]',
            resource: 'aws_apigatewayv2_route',
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
    const doubleQuotedRouteNode = adapter.getNodeAttributes(doubleQuotedRouteId);
    if (!routeNode || !doubleQuotedRouteNode) {
      throw new Error('Missing API gateway route nodes');
    }

    normalizeRule.match(routeId, routeNode, adapter);
    const singleQuoteUpdated = normalizeRule.apply(routeId, routeNode, adapter);
    expect(singleQuoteUpdated.getNodeAttributes(routeId)?.terraform?.name).toBe('GET /orders');

    normalizeRule.match(doubleQuotedRouteId, doubleQuotedRouteNode, singleQuoteUpdated);
    const doubleQuoteUpdated = normalizeRule.apply(
      doubleQuotedRouteId,
      doubleQuotedRouteNode,
      singleQuoteUpdated,
    );
    expect(doubleQuoteUpdated.getNodeAttributes(doubleQuotedRouteId)?.terraform?.name).toBe(
      'GET /invoices',
    );
  });

  it('shoud normalize quoted route names and no-op for blank or unchanged route keys', () => {
    const quotedRouteId = asNodeId('resource.aws_apigatewayv2_route.quoted');
    const blankRouteId = asNodeId('resource.aws_apigatewayv2_route.blank');
    const unchangedRouteId = asNodeId('resource.aws_apigatewayv2_route.unchanged');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [quotedRouteId]: {
          id: quotedRouteId,
          label: 'route',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_route.quoted',
            resource: 'aws_apigatewayv2_route',
            name: '"GET /quoted"',
          },
        },
        [blankRouteId]: {
          id: blankRouteId,
          label: 'route',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_route.blank',
            resource: 'aws_apigatewayv2_route',
            name: '   ',
          },
        },
        [unchangedRouteId]: {
          id: unchangedRouteId,
          label: 'route',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_route.unchanged',
            resource: 'aws_apigatewayv2_route',
            name: 'GET /same',
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

    const quotedRouteNode = adapter.getNodeAttributes(quotedRouteId);
    if (!quotedRouteNode) {
      throw new Error('Missing quoted route node');
    }

    normalizeRule.match(quotedRouteId, quotedRouteNode, adapter);
    const quotedUpdated = normalizeRule.apply(quotedRouteId, quotedRouteNode, adapter);
    expect(quotedUpdated.getNodeAttributes(quotedRouteId)?.terraform?.name).toBe('GET /quoted');

    const blankRouteNode = adapter.getNodeAttributes(blankRouteId);
    if (!blankRouteNode) {
      throw new Error('Missing blank route node');
    }

    normalizeRule.match(blankRouteId, blankRouteNode, quotedUpdated);
    const blankUpdated = normalizeRule.apply(blankRouteId, blankRouteNode, quotedUpdated);
    expect(blankUpdated).toBe(quotedUpdated);

    const unchangedRouteNode = adapter.getNodeAttributes(unchangedRouteId);
    if (!unchangedRouteNode) {
      throw new Error('Missing unchanged route node');
    }

    normalizeRule.match(unchangedRouteId, unchangedRouteNode, blankUpdated);
    const unchangedUpdated = normalizeRule.apply(
      unchangedRouteId,
      unchangedRouteNode,
      blankUpdated,
    );
    expect(unchangedUpdated).toBe(blankUpdated);
  });

  it('shoud no-op route normalization when route key cannot be resolved', () => {
    const routeId = asNodeId('resource.aws_apigatewayv2_route.no_key');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [routeId]: {
          id: routeId,
          label: 'route',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_route.no_key',
            resource: 'aws_apigatewayv2_route',
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
      throw new Error('Missing route node');
    }

    normalizeRule.match(routeId, routeNode, adapter);
    const updated = normalizeRule.apply(routeId, routeNode, adapter);
    expect(updated).toBe(adapter);
  });

  it('shoud no-op when apply is called without a matching node for all normalization rules', () => {
    const restApiId = asNodeId('resource.aws_api_gateway_rest_api.api');
    const routeId = asNodeId('resource.aws_apigatewayv2_route.route');
    const httpApiId = asNodeId('resource.aws_apigatewayv2_api.http');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [restApiId]: {
          id: restApiId,
          label: 'api',
          terraform: {
            kind: 'resource',
            address: 'aws_api_gateway_rest_api.api',
            resource: 'aws_api_gateway_rest_api',
            name: 'api',
          },
        },
        [routeId]: {
          id: routeId,
          label: 'route',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_route.route',
            resource: 'aws_apigatewayv2_route',
            name: 'GET /route',
          },
        },
        [httpApiId]: {
          id: httpApiId,
          label: 'http',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_api.http',
            resource: 'aws_apigatewayv2_api',
            name: 'http',
          },
        },
      },
      edges: [],
    });

    const restRule = buildRules().find(
      (rule) => rule.serialize().id === 'NormalizeRestApiResourcePathToRoute',
    );
    const routeRule = buildRules().find(
      (rule) => rule.serialize().id === 'NormalizeHttpApiRouteToRouteConcept',
    );
    const relinkRule = buildRules().find(
      (rule) => rule.serialize().id === 'RelinkHttpApiToRouteToIntegration',
    );

    if (!restRule || !routeRule || !relinkRule) {
      throw new Error('Missing one or more API gateway normalization rules');
    }

    const restNode = adapter.getNodeAttributes(restApiId);
    const routeNode = adapter.getNodeAttributes(routeId);
    const apiNode = adapter.getNodeAttributes(httpApiId);
    if (!restNode || !routeNode || !apiNode) {
      throw new Error('Missing test nodes');
    }

    expect(restRule.apply(restApiId, restNode, adapter)).toBe(adapter);
    expect(routeRule.apply(routeId, routeNode, adapter)).toBe(adapter);
    expect(relinkRule.apply(httpApiId, apiNode, adapter)).toBe(adapter);
  });

  it('shoud no-op rest resource compression for unsupported predecessor chains', () => {
    const restApiId = asNodeId('resource.aws_api_gateway_rest_api.my_api');
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
      },
      edges: [],
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
    expect(updated).toBe(adapter);
  });

  it('shoud no-op rest resource compression when closest resource becomes unavailable', () => {
    const restApiId = asNodeId('resource.aws_api_gateway_rest_api.mock');
    const resourceId = asNodeId('resource.aws_api_gateway_resource.mock');
    const rule = buildRules().find(
      (currentRule) => currentRule.serialize().id === 'NormalizeRestApiResourcePathToRoute',
    );

    if (!rule) {
      throw new Error('Missing NormalizeRestApiResourcePathToRoute');
    }

    const restNode: TgNode = {
      id: restApiId,
      label: 'api',
      terraform: {
        kind: 'resource',
        address: 'aws_api_gateway_rest_api.mock',
        resource: 'aws_api_gateway_rest_api',
        name: 'mock',
      },
    };
    const predecessorNode: TgNode = {
      id: resourceId,
      label: 'resource',
      terraform: {
        kind: 'resource',
        address: 'aws_api_gateway_resource.mock',
        resource: 'aws_api_gateway_resource',
        name: 'mock',
      },
    };

    let getNodeAttributesCallCount = 0;
    const graph = {
      predecessors: (nodeId: NodeId) => {
        if (nodeId === restApiId) {
          return [resourceId];
        }
        return [];
      },
      getNodeAttributes: (nodeId: NodeId) => {
        if (nodeId !== resourceId) {
          return undefined;
        }
        getNodeAttributesCallCount += 1;
        return getNodeAttributesCallCount === 1 ? predecessorNode : undefined;
      },
    } as unknown as AdapterOperations;

    rule.match(restApiId, restNode, graph);
    expect(rule.apply(restApiId, restNode, graph)).toBe(graph);
  });

  it('shoud no-op route normalization when matched node has no terraform payload', () => {
    const routeId = asNodeId('resource.aws_apigatewayv2_route.with_terraform');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [routeId]: {
          id: routeId,
          label: 'route',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_route.with_terraform',
            resource: 'aws_apigatewayv2_route',
            name: 'GET /with-terraform',
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
      throw new Error('Missing route node');
    }

    normalizeRule.match(routeId, routeNode, adapter);
    const updated = normalizeRule.apply(routeId, { id: routeId, label: 'route' }, adapter);

    expect(updated).toBe(adapter);
  });

  it('shoud no-op relinking when no api integrations are present', () => {
    const apiId = asNodeId('resource.aws_apigatewayv2_api.no_integrations');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [apiId]: {
          id: apiId,
          label: 'http',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_api.no_integrations',
            resource: 'aws_apigatewayv2_api',
            name: 'no_integrations',
          },
        },
      },
      edges: [],
    });

    const relinkRule = buildRules().find(
      (rule) => rule.serialize().id === 'RelinkHttpApiToRouteToIntegration',
    );
    if (!relinkRule) {
      throw new Error('Missing RelinkHttpApiToRouteToIntegration');
    }

    const apiNode = adapter.getNodeAttributes(apiId);
    if (!apiNode) {
      throw new Error('Missing API node');
    }

    relinkRule.match(apiId, apiNode, adapter);
    const updated = relinkRule.apply(apiId, apiNode, adapter);

    expect(updated).toBe(adapter);
  });

  it('shoud ignore route candidates outside api module scope and parent module scope', () => {
    const apiId = asNodeId('resource.aws_apigatewayv2_api.scope');
    const moduleMismatchRouteId = asNodeId('resource.aws_apigatewayv2_route.module_mismatch');
    const parentMismatchRouteId = asNodeId('resource.aws_apigatewayv2_route.parent_mismatch');
    const integrationId = asNodeId('resource.aws_apigatewayv2_integration.scope');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [apiId]: {
          id: apiId,
          label: 'http',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_api.scope',
            resource: 'aws_apigatewayv2_api',
            name: 'scope',
            moduleAddress: 'module.api',
            parentModuleNodeId: asNodeId('module-node-a'),
          },
        },
        [moduleMismatchRouteId]: {
          id: moduleMismatchRouteId,
          label: 'module mismatch',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_route.module_mismatch',
            resource: 'aws_apigatewayv2_route',
            name: 'GET /module-mismatch',
            moduleAddress: 'module.other',
            parentModuleNodeId: asNodeId('module-node-a'),
          },
        },
        [parentMismatchRouteId]: {
          id: parentMismatchRouteId,
          label: 'parent mismatch',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_route.parent_mismatch',
            resource: 'aws_apigatewayv2_route',
            name: 'GET /parent-mismatch',
            moduleAddress: 'module.api',
            parentModuleNodeId: asNodeId('module-node-b'),
          },
        },
        [integrationId]: {
          id: integrationId,
          label: 'integration',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_integration.scope',
            resource: 'aws_apigatewayv2_integration',
            name: 'scope',
          },
        },
      },
      edges: [
        {
          id: asEdgeId('edge-api-integration'),
          from: apiId,
          to: integrationId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-module-route-integration'),
          from: moduleMismatchRouteId,
          to: integrationId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-parent-route-integration'),
          from: parentMismatchRouteId,
          to: integrationId,
          attributes: {},
        },
      ],
    });

    const relinkRule = buildRules().find(
      (rule) => rule.serialize().id === 'RelinkHttpApiToRouteToIntegration',
    );
    if (!relinkRule) {
      throw new Error('Missing RelinkHttpApiToRouteToIntegration');
    }

    const apiNode = adapter.getNodeAttributes(apiId);
    if (!apiNode) {
      throw new Error('Missing API node');
    }

    relinkRule.match(apiId, apiNode, adapter);
    const moduleScopeUpdated = relinkRule.apply(apiId, apiNode, adapter);
    expect(moduleScopeUpdated).toBe(adapter);

    const parentScopeUpdated = relinkRule.apply(
      apiId,
      {
        ...apiNode,
        terraform: { ...apiNode.terraform, moduleAddress: 'module.api' },
      },
      adapter,
    );
    expect(parentScopeUpdated).toBe(adapter);
  });

  it('shoud no-op relinking when routes do not reference api integrations', () => {
    const apiId = asNodeId('resource.aws_apigatewayv2_api.unlinked');
    const routeId = asNodeId('resource.aws_apigatewayv2_route.unlinked');
    const integrationId = asNodeId('resource.aws_apigatewayv2_integration.unlinked');
    const otherNodeId = asNodeId('resource.aws_lambda_function.other');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [apiId]: {
          id: apiId,
          label: 'http',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_api.unlinked',
            resource: 'aws_apigatewayv2_api',
            name: 'unlinked',
          },
        },
        [routeId]: {
          id: routeId,
          label: 'route',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_route.unlinked',
            resource: 'aws_apigatewayv2_route',
            name: 'GET /unlinked',
          },
        },
        [integrationId]: {
          id: integrationId,
          label: 'integration',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_integration.unlinked',
            resource: 'aws_apigatewayv2_integration',
            name: 'unlinked',
          },
        },
        [otherNodeId]: {
          id: otherNodeId,
          label: 'other',
          terraform: {
            kind: 'resource',
            address: 'aws_lambda_function.other',
            resource: 'aws_lambda_function',
            name: 'other',
          },
        },
      },
      edges: [
        {
          id: asEdgeId('edge-api-integration'),
          from: apiId,
          to: integrationId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-route-other'),
          from: routeId,
          to: otherNodeId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-other-route'),
          from: otherNodeId,
          to: routeId,
          attributes: {},
        },
      ],
    });

    const relinkRule = buildRules().find(
      (rule) => rule.serialize().id === 'RelinkHttpApiToRouteToIntegration',
    );
    if (!relinkRule) {
      throw new Error('Missing RelinkHttpApiToRouteToIntegration');
    }

    const apiNode = adapter.getNodeAttributes(apiId);
    if (!apiNode) {
      throw new Error('Missing API node');
    }

    relinkRule.match(apiId, apiNode, adapter);
    const updated = relinkRule.apply(apiId, apiNode, adapter);
    expect(updated).toBe(adapter);
  });

  it('shoud relink integrations when route references are inbound to the route node', () => {
    const apiId = asNodeId('resource.aws_apigatewayv2_api.inbound_route');
    const routeId = asNodeId('resource.aws_apigatewayv2_route.inbound_route');
    const integrationId = asNodeId('resource.aws_apigatewayv2_integration.inbound_route');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [apiId]: {
          id: apiId,
          label: 'http',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_api.inbound_route',
            resource: 'aws_apigatewayv2_api',
            name: 'inbound_route',
          },
        },
        [routeId]: {
          id: routeId,
          label: 'route',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_route.inbound_route',
            resource: 'aws_apigatewayv2_route',
            name: 'GET /inbound',
          },
        },
        [integrationId]: {
          id: integrationId,
          label: 'integration',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_integration.inbound_route',
            resource: 'aws_apigatewayv2_integration',
            name: 'inbound_route',
          },
        },
      },
      edges: [
        {
          id: asEdgeId('edge-api-integration'),
          from: apiId,
          to: integrationId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-integration-route'),
          from: integrationId,
          to: routeId,
          attributes: {},
        },
      ],
    });

    const relinkRule = buildRules().find(
      (rule) => rule.serialize().id === 'RelinkHttpApiToRouteToIntegration',
    );
    if (!relinkRule) {
      throw new Error('Missing RelinkHttpApiToRouteToIntegration');
    }

    const apiNode = adapter.getNodeAttributes(apiId);
    if (!apiNode) {
      throw new Error('Missing API node');
    }

    relinkRule.match(apiId, apiNode, adapter);
    const updated = relinkRule.apply(apiId, apiNode, adapter);

    expect(updated).not.toBe(adapter);
    expect(updated.edgesBetween(apiId, routeId)).toHaveLength(1);
    expect(updated.edgesBetween(apiId, integrationId)).toHaveLength(0);
  });

  it('shoud evaluate route scope without api terraform metadata in apply input', () => {
    const apiId = asNodeId('resource.aws_apigatewayv2_api.missing_apply_terraform');
    const routeId = asNodeId('resource.aws_apigatewayv2_route.missing_apply_terraform');
    const integrationId = asNodeId('resource.aws_apigatewayv2_integration.missing_apply_terraform');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [apiId]: {
          id: apiId,
          label: 'http',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_api.missing_apply_terraform',
            resource: 'aws_apigatewayv2_api',
            name: 'missing_apply_terraform',
          },
        },
        [routeId]: {
          id: routeId,
          label: 'route',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_route.missing_apply_terraform',
            resource: 'aws_apigatewayv2_route',
            name: 'GET /missing-apply-terraform',
          },
        },
        [integrationId]: {
          id: integrationId,
          label: 'integration',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_integration.missing_apply_terraform',
            resource: 'aws_apigatewayv2_integration',
            name: 'missing_apply_terraform',
          },
        },
      },
      edges: [
        {
          id: asEdgeId('edge-api-integration'),
          from: apiId,
          to: integrationId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-route-integration'),
          from: routeId,
          to: integrationId,
          attributes: {},
        },
      ],
    });

    const relinkRule = buildRules().find(
      (rule) => rule.serialize().id === 'RelinkHttpApiToRouteToIntegration',
    );
    if (!relinkRule) {
      throw new Error('Missing RelinkHttpApiToRouteToIntegration');
    }

    const apiNode = adapter.getNodeAttributes(apiId);
    if (!apiNode) {
      throw new Error('Missing API node');
    }

    relinkRule.match(apiId, apiNode, adapter);
    const updated = relinkRule.apply(apiId, { id: apiId, label: 'http' }, adapter);

    expect(updated).not.toBe(adapter);
    expect(updated.edgesBetween(apiId, routeId)).toHaveLength(1);
  });

  it('shoud normalize route keys from terraform state and quoted single-quote forms', () => {
    const stateRouteId = asNodeId('resource.aws_apigatewayv2_route.state_key');
    const thisWrapperSingleQuoteRouteId = asNodeId(
      'resource.aws_apigatewayv2_route.this_wrapper_single_quote',
    );
    const quotedSingleQuoteRouteId = asNodeId(
      'resource.aws_apigatewayv2_route.quoted_single_quote',
    );
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [stateRouteId]: {
          id: stateRouteId,
          label: 'state route',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_route.state_key',
            resource: 'aws_apigatewayv2_route',
            state: {
              source: 'state_show',
              effective: {
                address: 'aws_apigatewayv2_route.state_key',
                values: {
                  route_key: 'GET /state',
                },
              },
              instances: [],
            },
          },
        },
        [thisWrapperSingleQuoteRouteId]: {
          id: thisWrapperSingleQuoteRouteId,
          label: 'this wrapper single quote',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_route.this_wrapper_single_quote',
            resource: 'aws_apigatewayv2_route',
            name: "this['GET /single-wrapper']",
          },
        },
        [quotedSingleQuoteRouteId]: {
          id: quotedSingleQuoteRouteId,
          label: 'quoted single quote',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_route.quoted_single_quote',
            resource: 'aws_apigatewayv2_route',
            name: "'GET /single-quoted'",
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

    const stateRouteNode = adapter.getNodeAttributes(stateRouteId);
    const thisWrapperSingleQuoteRouteNode = adapter.getNodeAttributes(
      thisWrapperSingleQuoteRouteId,
    );
    const quotedSingleQuoteRouteNode = adapter.getNodeAttributes(quotedSingleQuoteRouteId);
    if (!stateRouteNode || !thisWrapperSingleQuoteRouteNode || !quotedSingleQuoteRouteNode) {
      throw new Error('Missing state/single-quote route nodes');
    }

    normalizeRule.match(stateRouteId, stateRouteNode, adapter);
    const stateUpdated = normalizeRule.apply(stateRouteId, stateRouteNode, adapter);
    expect(stateUpdated.getNodeAttributes(stateRouteId)?.terraform?.name).toBe('GET /state');

    normalizeRule.match(
      thisWrapperSingleQuoteRouteId,
      thisWrapperSingleQuoteRouteNode,
      stateUpdated,
    );
    const thisWrapperSingleQuoteUpdated = normalizeRule.apply(
      thisWrapperSingleQuoteRouteId,
      thisWrapperSingleQuoteRouteNode,
      stateUpdated,
    );
    expect(
      thisWrapperSingleQuoteUpdated.getNodeAttributes(thisWrapperSingleQuoteRouteId)?.terraform
        ?.name,
    ).toBe('GET /single-wrapper');

    normalizeRule.match(
      quotedSingleQuoteRouteId,
      quotedSingleQuoteRouteNode,
      thisWrapperSingleQuoteUpdated,
    );
    const quotedSingleQuoteUpdated = normalizeRule.apply(
      quotedSingleQuoteRouteId,
      quotedSingleQuoteRouteNode,
      thisWrapperSingleQuoteUpdated,
    );
    expect(
      quotedSingleQuoteUpdated.getNodeAttributes(quotedSingleQuoteRouteId)?.terraform?.name,
    ).toBe('GET /single-quoted');
  });

  it('shoud no-op route normalization for non-object terraform.state and non-string addresses', () => {
    const routeId = asNodeId('resource.aws_apigatewayv2_route.no_state');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [routeId]: {
          id: routeId,
          label: 'route',
          terraform: {
            kind: 'resource',
            address: 123 as unknown as string,
            resource: 'aws_apigatewayv2_route',
            state: [] as unknown as TgNodeTerraformState,
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
      throw new Error('Missing route node');
    }

    normalizeRule.match(routeId, routeNode, adapter);
    const updated = normalizeRule.apply(routeId, routeNode, adapter);

    expect(updated).toBe(adapter);
  });

  it('shoud no-op route normalization when extracted address keys are blank after trim', () => {
    const doubleQuotedRouteId = asNodeId('resource.aws_apigatewayv2_route.blank_double_quote');
    const singleQuotedRouteId = asNodeId('resource.aws_apigatewayv2_route.blank_single_quote');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [doubleQuotedRouteId]: {
          id: doubleQuotedRouteId,
          label: 'route',
          terraform: {
            kind: 'resource',
            address: 'aws_apigatewayv2_route.this["   "]',
            resource: 'aws_apigatewayv2_route',
          },
        },
        [singleQuotedRouteId]: {
          id: singleQuotedRouteId,
          label: 'route',
          terraform: {
            kind: 'resource',
            address: "aws_apigatewayv2_route.this['   ']",
            resource: 'aws_apigatewayv2_route',
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

    const doubleQuotedRouteNode = adapter.getNodeAttributes(doubleQuotedRouteId);
    const singleQuotedRouteNode = adapter.getNodeAttributes(singleQuotedRouteId);
    if (!doubleQuotedRouteNode || !singleQuotedRouteNode) {
      throw new Error('Missing blank route nodes');
    }

    normalizeRule.match(doubleQuotedRouteId, doubleQuotedRouteNode, adapter);
    const afterDoubleQuote = normalizeRule.apply(
      doubleQuotedRouteId,
      doubleQuotedRouteNode,
      adapter,
    );
    expect(afterDoubleQuote).toBe(adapter);

    normalizeRule.match(singleQuotedRouteId, singleQuotedRouteNode, afterDoubleQuote);
    const afterSingleQuote = normalizeRule.apply(
      singleQuotedRouteId,
      singleQuotedRouteNode,
      afterDoubleQuote,
    );
    expect(afterSingleQuote).toBe(afterDoubleQuote);
  });

  it('shoud build compressed route names from resource ids when terraform names are missing', () => {
    const restApiId = asNodeId('resource.aws_api_gateway_rest_api.fallback_names');
    const resourceParentId = asNodeId('resource.aws_api_gateway_resource.parent');
    const resourceChildId = asNodeId('resource.aws_api_gateway_resource.child');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [restApiId]: {
          id: restApiId,
          label: 'api',
          terraform: {
            kind: 'resource',
            address: 'aws_api_gateway_rest_api.fallback_names',
            resource: 'aws_api_gateway_rest_api',
            name: 'fallback_names',
          },
        },
        [resourceChildId]: {
          id: resourceChildId,
          label: 'child',
          terraform: {
            kind: 'resource',
            address: 'aws_api_gateway_resource.child',
            resource: 'aws_api_gateway_resource',
          },
        },
        [resourceParentId]: {
          id: resourceParentId,
          label: 'parent',
          terraform: {
            kind: 'resource',
            address: 'aws_api_gateway_resource.parent',
            resource: 'aws_api_gateway_resource',
          },
        },
      },
      edges: [
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
    expect(
      updated
        .nodeIds()
        .some((nodeId) => nodeId.includes('resource.aws_api_gateway_resource.child')),
    ).toBe(true);
  });
});
