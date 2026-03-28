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
  asEdgeId,
  asNodeId,
  tgNodeIdFrom,
} from '@terra-graph/core';
import { AwsApiGateway } from './AwsApiGateway.js';

type SerializedPhaseStep = {
  phase: NamedPhase;
  rules: SerializedRule[];
};

const buildPhases = (): SerializedPhaseStep[] => {
  const plugin = new AwsApiGateway();
  const result = plugin.build({
    options: {},
    namedRules: new NamedRuleRegistry(),
    namedRuleSets: new NamedRuleSetRegistry(),
  } as GraphPluginBuildInput);

  return (result.phases ?? []).map((phase) => ({
    phase: phase.phase,
    rules: phase.rules.map((rule) => (rule as BaseRule).serialize()),
  }));
};

const buildRules = (): BaseRule[] => {
  const plugin = new AwsApiGateway();
  const result = plugin.build({
    options: {},
    namedRules: new NamedRuleRegistry(),
    namedRuleSets: new NamedRuleSetRegistry(),
  } as GraphPluginBuildInput);

  return (result.phases?.[1]?.rules ?? []).map((rule) => rule as BaseRule);
};

const getCompressRule = (): BaseRule => {
  const [compressRule] = buildRules();
  return compressRule;
};

const buildAdapter = (graph: TgGraph): AdapterOperations => {
  return new GraphologyAdapter().withTgGraph(graph);
};

describe('AwsApiGateway.build', () => {
  it('shoud build expected aws api gateway cleanup phases', () => {
    const phases = buildPhases();

    expect(phases).toHaveLength(4);
    expect(phases.map((phase) => phase.phase)).toStrictEqual(['main', 'main', 'main', 'main']);
    expect(phases[0]?.rules).toHaveLength(1);
    expect(phases[0]?.rules[0]).toStrictEqual({
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
              'aws_wafv2_web_acl_logging_configuration',
            ],
          },
        },
      },
    });
    expect(phases[1]?.rules).toHaveLength(1);
    expect(phases[1]?.rules[0]?.id).toBe('CompressApiGatewayResourcePath');
    expect(phases[2]?.rules).toHaveLength(5);
    expect(phases[2]?.rules.every((rule) => rule.id === 'EdgeReverse')).toBe(true);
    expect(phases[3]?.rules).toHaveLength(1);
    expect(phases[3]?.rules[0]).toStrictEqual({
      id: 'ConvertNodeToEdge',
      config: {
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
      },
    });
  });

  it('shoud collapse chained gateway resource nodes into a compressed path node', () => {
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
            address: 'aws_api_gateway_resource_parent.parent',
            resource: 'aws_api_gateway_rest_api',
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

    const compressRule = getCompressRule();
    const restNode = adapter.getNodeAttributes(restApiId);
    if (!restNode) {
      throw new Error('Missing API gateway rest api node');
    }
    compressRule.match(restApiId, restNode, adapter);
    const updated = compressRule.apply(restApiId, restNode, adapter);

    expect(updated).not.toBe(adapter);
    expect(updated.nodeIds()).toContain(expectedCompressedId);
    expect(updated.getNodeAttributes(expectedCompressedId)).toMatchObject({
      terraform: {
        kind: 'resource',
        address: 'aws_api_gateway_resource.users/api',
        resource: 'aws_api_gateway_resource',
        name: 'users/api',
      },
    });
    expect(updated.nodeIds()).not.toContain(resourceChildId);
    expect(updated.nodeIds()).not.toContain(resourceParentId);
    expect(updated.edgesBetween(rootId, expectedCompressedId)).toHaveLength(1);
    expect(updated.edgesBetween(expectedCompressedId, methodNodeId)).toHaveLength(1);
    expect(updated.edgesBetween(expectedCompressedId, restApiId)).toHaveLength(1);
    expect(updated.nodeIds()).not.toContain(resourceChildId);
  });

  it('shoud keep graph unchanged when aws_api_gateway_rest_api has non-resource parent chain', () => {
    const restApiId = asNodeId('resource.aws_api_gateway_rest_api.blank');
    const nonApiParentId = asNodeId('resource.something.parent');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [nonApiParentId]: {
          id: nonApiParentId,
          label: 'parent',
          terraform: {
            kind: 'resource',
            address: 'random.parent',
            resource: 'aws_lambda_function',
            name: 'parent',
          },
        },
        [restApiId]: {
          id: restApiId,
          label: 'api',
          terraform: {
            kind: 'resource',
            address: 'aws_api_gateway_rest_api.blank',
            resource: 'aws_api_gateway_rest_api',
            name: 'blank',
          },
        },
      },
      edges: [
        {
          id: asEdgeId('edge-parent-rest'),
          from: nonApiParentId,
          to: restApiId,
          attributes: {},
        },
      ],
    });

    const compressRule = getCompressRule();
    const restNode = adapter.getNodeAttributes(restApiId);
    if (!restNode) {
      throw new Error('Missing API gateway rest api node');
    }
    compressRule.match(restApiId, restNode, adapter);
    const updated = compressRule.apply(restApiId, restNode, adapter);

    expect(updated).toBe(adapter);
    expect(updated.nodeIds()).toContain(nonApiParentId);
    expect(updated.nodeIds()).toContain(restApiId);
    expect(updated.nodeIds()).not.toContain(
      tgNodeIdFrom('resource', 'aws_api_gateway_resource.blank'),
    );
  });

  it('shoud do nothing when CompressApiGatewayResourcePath.apply is not matched', () => {
    const restApiId = asNodeId('resource.aws_api_gateway_rest_api.blank');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [restApiId]: {
          id: restApiId,
          label: 'api',
          terraform: {
            kind: 'resource',
            address: 'aws_api_gateway_rest_api.blank',
            resource: 'aws_api_gateway_rest_api',
            name: 'blank',
          },
        },
      },
      edges: [],
    });
    const compressRule = getCompressRule();

    const restNode = adapter.getNodeAttributes(restApiId);
    if (!restNode) {
      throw new Error('Missing API gateway rest api node');
    }
    const updated = compressRule.apply(restApiId, restNode, adapter);
    expect(updated).toBe(adapter);
  });

  it('shoud keep graph unchanged when predecessors are not a single parent', () => {
    const restApiId = asNodeId('resource.aws_api_gateway_rest_api.blank');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [restApiId]: {
          id: restApiId,
          label: 'api',
          terraform: {
            kind: 'resource',
            address: 'aws_api_gateway_rest_api.blank',
            resource: 'aws_api_gateway_rest_api',
            name: 'blank',
          },
        },
      },
      edges: [],
    });
    const compressRule = getCompressRule();

    const restNode = adapter.getNodeAttributes(restApiId);
    if (!restNode) {
      throw new Error('Missing API gateway rest api node');
    }
    compressRule.match(restApiId, restNode, adapter);
    const updated = compressRule.apply(restApiId, restNode, adapter);
    expect(updated).toBe(adapter);
  });

  it('shoud not create a compressed node when the nearest resource parent is missing', () => {
    const parentId = asNodeId('resource.aws_api_gateway_resource.api');
    const restApiId = asNodeId('resource.aws_api_gateway_rest_api.blank');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [parentId]: {
          id: parentId,
          label: 'api',
          terraform: {
            kind: 'resource',
            address: 'aws_api_gateway_resource.api',
            resource: 'aws_api_gateway_resource',
            name: 'api',
          },
        },
        [restApiId]: {
          id: restApiId,
          label: 'blank',
          terraform: {
            kind: 'resource',
            address: 'aws_api_gateway_rest_api.blank',
            resource: 'aws_api_gateway_rest_api',
            name: 'blank',
          },
        },
      },
      edges: [
        {
          id: asEdgeId('edge-parent-rest'),
          from: parentId,
          to: restApiId,
          attributes: {},
        },
      ],
    });
    const compressRule = getCompressRule();

    const callCounts = new Map<NodeId, number>();
    const getNodeAttributes = adapter.getNodeAttributes.bind(adapter);
    const spy = jest.spyOn(adapter, 'getNodeAttributes').mockImplementation((nodeId) => {
      if (nodeId === parentId) {
        const calls = (callCounts.get(nodeId) ?? 0) + 1;
        callCounts.set(nodeId, calls);
        if (calls === 1) {
          return getNodeAttributes(nodeId);
        }
        return undefined;
      }
      return getNodeAttributes(nodeId);
    });

    const restNode = adapter.getNodeAttributes(restApiId);
    if (!restNode) {
      throw new Error('Missing API gateway rest api node');
    }

    compressRule.match(restApiId, restNode, adapter);
    const updated = compressRule.apply(restApiId, restNode, adapter);
    spy.mockRestore();
    expect(updated).toBe(adapter);
  });

  it('shoud use the node id as the resource path when the resource name is missing', () => {
    const parentId = asNodeId('resource.aws_api_gateway_resource.api');
    const restApiId = asNodeId('resource.aws_api_gateway_rest_api.blank');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [parentId]: {
          id: parentId,
          label: 'api',
          terraform: {
            kind: 'resource',
            address: 'aws_api_gateway_resource.api',
            resource: 'aws_api_gateway_resource',
            name: 'api',
          },
        },
        [restApiId]: {
          id: restApiId,
          label: 'blank',
          terraform: {
            kind: 'resource',
            address: 'aws_api_gateway_rest_api.blank',
            resource: 'aws_api_gateway_rest_api',
            name: 'blank',
          },
        },
      },
      edges: [
        {
          id: asEdgeId('edge-parent-rest'),
          from: parentId,
          to: restApiId,
          attributes: {},
        },
      ],
    });
    const compressRule = getCompressRule();
    const callCounts = new Map<NodeId, number>();
    const originalGetNodeAttributes = adapter.getNodeAttributes.bind(adapter);
    const spy = jest.spyOn(adapter, 'getNodeAttributes').mockImplementation((nodeId) => {
      const calls = (callCounts.get(nodeId) ?? 0) + 1;
      callCounts.set(nodeId, calls);
      if (nodeId === parentId && calls === 3) {
        return {
          ...originalGetNodeAttributes(nodeId),
          terraform: {
            kind: 'resource',
            address: 'aws_api_gateway_resource.api',
            resource: 'aws_api_gateway_resource',
          },
        };
      }

      return originalGetNodeAttributes(nodeId);
    });

    const restNode = adapter.getNodeAttributes(restApiId);
    if (!restNode) {
      throw new Error('Missing API gateway rest api node');
    }

    compressRule.match(restApiId, restNode, adapter);
    const updated = compressRule.apply(restApiId, restNode, adapter);
    spy.mockRestore();

    const expectedCompressedId = tgNodeIdFrom('resource', `aws_api_gateway_resource.${parentId}`);
    expect(updated.nodeIds()).toContain(expectedCompressedId);
    expect(updated.getNodeAttributes(expectedCompressedId)).toMatchObject({
      terraform: {
        address: `aws_api_gateway_resource.${parentId}`,
        name: 'resource.aws_api_gateway_resource.api',
      },
    });
    expect(updated).not.toBe(adapter);
  });
});
