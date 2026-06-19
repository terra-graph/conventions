import { GraphologyAdapter, TG_SCHEMA_VERSION, type TgGraph, asNodeId } from '@terra-graph/core';
import { LayoutFlowOrder } from './LayoutFlowOrder.js';

describe('LayoutFlowOrder.constructor', () => {
  it('should require options in config', () => {
    expect(
      () =>
        new LayoutFlowOrder({
          node: { nodeId: { eq: 'node-a' } },
        }),
    ).toThrow(`Rule 'LayoutFlowOrder' requires options in config`);
  });

  it('should reject invalid order config', () => {
    expect(
      () =>
        new LayoutFlowOrder({
          node: { nodeId: { eq: 'node-a' } },
          options: {
            order: ['aws_lb'],
          },
        }),
    ).toThrow(`Rule 'LayoutFlowOrder' requires options.order to be an array of string arrays`);
  });

  it('should reject non-object, invalid numeric, and invalid priority options', () => {
    expect(
      () =>
        new LayoutFlowOrder({
          node: { nodeId: { eq: 'node-a' } },
          options: 'invalid',
        }),
    ).toThrow(`Rule 'LayoutFlowOrder' requires options to be an object`);

    expect(
      () =>
        new LayoutFlowOrder({
          node: { nodeId: { eq: 'node-a' } },
          options: {
            flowOrder: Number.NaN,
          },
        }),
    ).toThrow(`Rule 'LayoutFlowOrder' requires options.flowOrder to be a finite number`);

    expect(
      () =>
        new LayoutFlowOrder({
          node: { nodeId: { eq: 'node-a' } },
          options: {
            step: 0,
          },
        }),
    ).toThrow(`Rule 'LayoutFlowOrder' requires options.step to be a positive finite number`);

    expect(
      () =>
        new LayoutFlowOrder({
          node: { nodeId: { eq: 'node-a' } },
          options: {
            orderPriority: { aws_lb: Number.POSITIVE_INFINITY },
          },
        }),
    ).toThrow(
      `Rule 'LayoutFlowOrder' requires options.orderPriority to be a record of finite numbers`,
    );
  });
});

describe('LayoutFlowOrder.apply', () => {
  it('should keep the node unchanged when it was not matched', () => {
    const nodeId = asNodeId('node-a');
    const tg: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [nodeId]: {
          id: nodeId,
          terraform: {
            kind: 'resource',
            address: 'aws_lb.this',
            resource: 'aws_lb',
            name: 'this',
          },
        },
      },
      edges: [],
    };

    const adapter = new GraphologyAdapter().withTgGraph(tg);
    const node = adapter.getNodeAttributes(nodeId);
    if (!node) {
      throw new Error('Missing node attributes');
    }

    const rule = new LayoutFlowOrder({
      node: { nodeId: { eq: 'other-node' } },
      options: {
        flowOrder: 10,
      },
    });

    const result = rule.apply(nodeId, node, adapter);

    expect(result.getNodeAttributes(nodeId)).toEqual(node);
  });

  it('should apply an explicit flowOrder override', () => {
    const nodeId = asNodeId('node-a');
    const tg: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [nodeId]: {
          id: nodeId,
          terraform: {
            kind: 'resource',
            address: 'aws_lb.this',
            resource: 'aws_lb',
            name: 'this',
          },
          hints: {
            layout: {
              text1: 'Load Balancer',
            },
          },
        },
      },
      edges: [],
    };

    const adapter = new GraphologyAdapter().withTgGraph(tg);
    const node = adapter.getNodeAttributes(nodeId);
    if (!node) {
      throw new Error('Missing node attributes');
    }

    const rule = new LayoutFlowOrder({
      node: { nodeId: { eq: nodeId.toString() } },
      options: {
        flowOrder: 5,
        order: [['aws_lb', 'aws_ecs_service']],
        orderPriority: { aws_lb: 100 },
      },
    });

    rule.match(nodeId, node, adapter);
    const result = rule.apply(nodeId, node, adapter);

    expect(result.getNodeAttributes(nodeId)?.hints?.layout).toEqual({
      text1: 'Load Balancer',
      flowOrder: 5,
    });
  });

  it('should derive flowOrder from the first matching chain', () => {
    const nodeId = asNodeId('node-a');
    const tg: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [nodeId]: {
          id: nodeId,
          terraform: {
            kind: 'resource',
            address: 'aws_lb.this',
            resource: 'aws_lb',
            name: 'this',
          },
        },
      },
      edges: [],
    };

    const adapter = new GraphologyAdapter().withTgGraph(tg);
    const node = adapter.getNodeAttributes(nodeId);
    if (!node) {
      throw new Error('Missing node attributes');
    }

    const rule = new LayoutFlowOrder({
      node: { nodeId: { eq: nodeId.toString() } },
      options: {
        step: 25,
        order: [
          ['aws_iam_role', 'aws_lb', 'aws_ecs_service'],
          ['aws_lb', 'aws_lambda_function'],
        ],
      },
    });

    rule.match(nodeId, node, adapter);
    const result = rule.apply(nodeId, node, adapter);

    expect(result.getNodeAttributes(nodeId)?.hints?.layout?.flowOrder).toBe(50);
  });

  it('should use orderPriority when no chain matches', () => {
    const nodeId = asNodeId('node-a');
    const tg: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [nodeId]: {
          id: nodeId,
          terraform: {
            kind: 'resource',
            address: 'aws_iam_role.this',
            resource: 'aws_iam_role',
            name: 'this',
          },
        },
      },
      edges: [],
    };

    const adapter = new GraphologyAdapter().withTgGraph(tg);
    const node = adapter.getNodeAttributes(nodeId);
    if (!node) {
      throw new Error('Missing node attributes');
    }

    const rule = new LayoutFlowOrder({
      node: { nodeId: { eq: nodeId.toString() } },
      options: {
        order: [['aws_lb', 'aws_ecs_service']],
        orderPriority: { aws_iam_role: 200 },
      },
    });

    rule.match(nodeId, node, adapter);
    const result = rule.apply(nodeId, node, adapter);

    expect(result.getNodeAttributes(nodeId)?.hints?.layout?.flowOrder).toBe(200);
  });

  it('should leave unmatched resources unchanged when no flow order can be derived', () => {
    const nodeId = asNodeId('node-a');
    const tg: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [nodeId]: {
          id: nodeId,
          terraform: {
            kind: 'resource',
            address: 'aws_iam_role.this',
            resource: 'aws_iam_role',
            name: 'this',
          },
        },
      },
      edges: [],
    };

    const adapter = new GraphologyAdapter().withTgGraph(tg);
    const node = adapter.getNodeAttributes(nodeId);
    if (!node) {
      throw new Error('Missing node attributes');
    }

    const rule = new LayoutFlowOrder({
      node: { nodeId: { eq: nodeId.toString() } },
      options: {
        order: [['aws_lb', 'aws_ecs_service']],
      },
    });

    rule.match(nodeId, node, adapter);
    const result = rule.apply(nodeId, node, adapter);

    expect(result.getNodeAttributes(nodeId)).toEqual(node);
  });

  it('should use the default step and ignore nodes without a terraform resource', () => {
    const resourceNodeId = asNodeId('node-resource');
    const metadataNodeId = asNodeId('node-metadata');
    const tg: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [resourceNodeId]: {
          id: resourceNodeId,
          terraform: {
            kind: 'resource',
            address: 'aws_lambda_function.this',
            resource: 'aws_lambda_function',
            name: 'this',
          },
        },
        [metadataNodeId]: {
          id: metadataNodeId,
        },
      },
      edges: [],
    };

    const adapter = new GraphologyAdapter().withTgGraph(tg);
    const resourceNode = adapter.getNodeAttributes(resourceNodeId);
    const metadataNode = adapter.getNodeAttributes(metadataNodeId);
    if (!resourceNode || !metadataNode) {
      throw new Error('Missing node attributes');
    }

    const rule = new LayoutFlowOrder({
      node: { any: true },
      options: {
        order: [['aws_lb', 'aws_lambda_function']],
      },
    });

    rule.match(resourceNodeId, resourceNode, adapter);
    const resourceResult = rule.apply(resourceNodeId, resourceNode, adapter);
    expect(resourceResult.getNodeAttributes(resourceNodeId)?.hints?.layout?.flowOrder).toBe(20);

    rule.match(metadataNodeId, metadataNode, adapter);
    const metadataResult = rule.apply(metadataNodeId, metadataNode, adapter);
    expect(metadataResult.getNodeAttributes(metadataNodeId)).toEqual(metadataNode);
  });

  it('should allow order to be omitted entirely', () => {
    const nodeId = asNodeId('node-priority-only');
    const tg: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [nodeId]: {
          id: nodeId,
          terraform: {
            kind: 'resource',
            address: 'aws_s3_bucket.this',
            resource: 'aws_s3_bucket',
            name: 'this',
          },
        },
      },
      edges: [],
    };

    const adapter = new GraphologyAdapter().withTgGraph(tg);
    const node = adapter.getNodeAttributes(nodeId);
    if (!node) {
      throw new Error('Missing node attributes');
    }

    const rule = new LayoutFlowOrder({
      node: { any: true },
      options: {
        orderPriority: { aws_s3_bucket: 15 },
      },
    });

    rule.match(nodeId, node, adapter);
    const result = rule.apply(nodeId, node, adapter);
    expect(result.getNodeAttributes(nodeId)?.hints?.layout?.flowOrder).toBe(15);
  });
});
