import {
  BaseRule,
  GraphResolver,
  GraphologyAdapter,
  type TgGraph,
  type TgNodeTerraformState,
  edgeIdFrom,
  tgNodeIdFrom,
} from '@terra-graph/core';
import { RemoveUninstantiatedResources } from './RemoveUninstantiatedResources.js';

const address = 'module.package.aws_lambda_function.this';
const nodeId = tgNodeIdFrom('resource', address);
const emptyState: TgNodeTerraformState = {
  source: 'plan_show',
  effective: null,
  instances: [],
};

const buildGraph = (state?: TgNodeTerraformState): TgGraph => ({
  schemaVersion: '1.0.0',
  description: {},
  nodes: {
    [nodeId]: {
      id: nodeId,
      terraform: { kind: 'resource', address, state },
    },
  },
  edges: [],
});

const resolve = (graph: TgGraph): TgGraph =>
  new GraphResolver(new GraphologyAdapter())
    .resolve({
      graph,
      phases: [[new RemoveUninstantiatedResources({ node: { any: true } })]],
    })
    .toTgGraph();

describe('RemoveUninstantiatedResources.apply', () => {
  it('shoud remove confirmed empty resources and their edges without reconnecting peers', () => {
    const graph = buildGraph(emptyState);
    const source = tgNodeIdFrom('resource', 'aws_s3_bucket.source');
    const target = tgNodeIdFrom('resource', 'aws_s3_bucket.target');
    graph.nodes[source] = { id: source };
    graph.nodes[target] = { id: target };
    graph.edges = [
      { id: edgeIdFrom(source, nodeId), from: source, to: nodeId },
      { id: edgeIdFrom(nodeId, target), from: nodeId, to: target },
    ];

    const result = resolve(graph);

    expect(Object.keys(result.nodes)).toEqual([source, target]);
    expect(result.edges).toEqual([]);
  });

  it.each([
    ['unknown', undefined],
    ['state-only', { ...emptyState, source: 'state_show' as const }],
    ['effective', { ...emptyState, effective: { address, values: {} } }],
    ['instantiated', { ...emptyState, instances: [{ address, values: {} }] }],
  ])('shoud preserve %s resource evidence', (_name, state) => {
    expect(resolve(buildGraph(state)).nodes[nodeId]).toBeDefined();
  });

  it('shoud preserve non-resource nodes even with an empty plan state', () => {
    const graph = buildGraph(emptyState);
    graph.nodes[nodeId].terraform = { kind: 'data', address, state: emptyState };

    expect(resolve(graph).nodes[nodeId]).toBeDefined();
  });

  it('shoud respect matching before applying the rule', () => {
    const graph = buildGraph(emptyState);
    const adapter = new GraphologyAdapter().withTgGraph(graph);
    const rule = new RemoveUninstantiatedResources({ node: { any: true } });

    expect(rule.apply(nodeId, graph.nodes[nodeId], adapter)).toBe(adapter);
    expect(adapter.toTgGraph().nodes[nodeId]).toBeDefined();
  });

  it.each([
    { nodeId, address: `${address}[0]` },
    { address: `${address}["blue"]` },
    { address: 'aws_lambda_function.renamed', previousAddress: `${address}[0]` },
  ])('shoud preserve resources referenced by separate change evidence %j', (change) => {
    const graph = buildGraph(emptyState);
    graph.changes = {
      source: 'terraform_plan',
      resources: { [change.address]: { ...change, matched: true, actions: ['delete'] } },
    };

    expect(resolve(graph).nodes[nodeId]).toBeDefined();
  });

  it('shoud remove empty resources when change evidence belongs to other resources', () => {
    const graph = buildGraph(emptyState);
    graph.changes = {
      source: 'terraform_plan',
      resources: {
        'aws_s3_bucket.other': {
          address: 'aws_s3_bucket.other',
          matched: false,
          actions: ['create'],
        },
      },
    };

    expect(resolve(graph).nodes[nodeId]).toBeUndefined();
  });

  it('shoud remove confirmed empty nodes without addresses', () => {
    const graph = buildGraph(emptyState);
    graph.nodes[nodeId].terraform = { kind: 'resource', state: emptyState };
    graph.changes = {
      source: 'terraform_plan',
      resources: {
        other: { address: 'aws_s3_bucket.other', matched: false, actions: ['create'] },
      },
    };

    expect(resolve(graph).nodes[nodeId]).toBeUndefined();
  });
});

describe('RemoveUninstantiatedResources.serialize', () => {
  it('shoud register the rule for deserialization', () => {
    const rule = new RemoveUninstantiatedResources({ node: { any: true } });

    expect(BaseRule.fromSerialized(rule.serialize())).toBeInstanceOf(RemoveUninstantiatedResources);
  });
});
