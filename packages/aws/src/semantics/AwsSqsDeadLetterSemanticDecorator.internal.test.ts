import {
  GraphologyAdapter,
  TG_SCHEMA_VERSION,
  type TgGraph,
  asEdgeId,
  asNodeId,
} from '@terra-graph/core';
import { DirectedGraph } from 'graphology';
import {
  AwsSqsDeadLetterSemanticDecorator,
  __testing,
} from './AwsSqsDeadLetterSemanticDecorator.js';

const buildAdapter = (graph: TgGraph) =>
  new GraphologyAdapter(
    new DirectedGraph() as unknown as ConstructorParameters<typeof GraphologyAdapter>[0],
  ).withTgGraph(graph);

const createMockGraph = (
  nodes: Record<string, unknown>,
  edges: Array<{ id: string; from: string; to: string; attributes?: Record<string, unknown> }>,
) =>
  ({
    nodeIds: () => Object.keys(nodes),
    getNodeAttributes: (nodeId: string) => nodes[nodeId],
    outEdges: (nodeId: string) =>
      edges.filter((edge) => edge.from === nodeId).map((edge) => edge.id),
    inEdges: (nodeId: string) => edges.filter((edge) => edge.to === nodeId).map((edge) => edge.id),
    edgeTarget: (edgeId: string) => edges.find((edge) => edge.id === edgeId)?.to,
    edgeSource: (edgeId: string) => edges.find((edge) => edge.id === edgeId)?.from,
    getEdgeAttributes: (edgeId: string) =>
      edges.find((edge) => edge.id === edgeId)?.attributes ?? {},
  }) as never;

describe('AwsSqsDeadLetterSemanticDecorator internals', () => {
  it('should cover parsing and queue helpers', () => {
    expect(__testing.parseJsonObject('{')).toBeUndefined();
    expect(__testing.parseJsonObject('[]')).toBeUndefined();
    expect(__testing.parseJsonObject('{"ok":true}')).toStrictEqual({ ok: true });
    expect(__testing.parseJsonArrayOfStrings({})).toStrictEqual([]);
    expect(__testing.parseJsonArrayOfStrings(['one', 2, 'two'])).toStrictEqual(['one', 'two']);
    expect(
      __testing
        .adjacentNodeIds(
          createMockGraph(
            {
              source: {},
              inbound: {},
              outbound: {},
            },
            [
              { id: 'inbound-edge', from: 'inbound', to: 'source' },
              { id: 'outbound-edge', from: 'source', to: 'outbound' },
            ],
          ),
          asNodeId('source'),
        )
        .sort(),
    ).toStrictEqual(['inbound', 'outbound']);

    const queueNode = {
      terraform: {
        resource: 'aws_sqs_queue',
        state: {
          effective: {
            address: 'aws_sqs_queue.source["abi"]',
            values: {
              name: 'source',
              arn: 'arn:aws:sqs:eu-west-2:123456789012:source',
            },
          },
          instances: [
            {
              address: 'aws_sqs_queue.source["mei"]',
              values: {
                name: 'source-mei',
              },
            },
            {
              address: 'aws_sqs_queue.source["ignored"]',
              values: 'invalid',
            },
          ],
        },
      },
    } as never;

    expect(__testing.collectQueueStateInstances(queueNode)).toHaveLength(2);
    expect(__testing.queueNameFromSqsArn('invalid')).toBeUndefined();
    expect(__testing.queueNameFromSqsArn('arn:aws:sqs:eu-west-2:123456789012:source')).toBe(
      'source',
    );
    expect(__testing.resolveQueueNames(queueNode)).toStrictEqual(['source', 'source-mei']);
    expect(__testing.resolveQueueArns(queueNode)).toStrictEqual([
      'arn:aws:sqs:eu-west-2:123456789012:source',
    ]);
    expect(__testing.parseInstanceKeyFromAddress(undefined)).toBeUndefined();
    expect(__testing.parseInstanceKeyFromAddress('aws_sqs_queue.source["abi"]')).toBe('abi');
    expect(__testing.parseInstanceKeyFromAddress('aws_sqs_queue.source[0]')).toBe('0');
    expect(
      __testing.resolveQueueInstanceMatch(
        queueNode,
        'arn:aws:sqs:eu-west-2:123456789012:source',
        'source',
      ),
    ).toStrictEqual({
      address: 'aws_sqs_queue.source["abi"]',
      instanceKey: 'abi',
    });
    expect(__testing.resolveQueueInstanceMatch(queueNode, 'missing', 'missing')).toBeUndefined();
    expect(
      __testing.deadLetterFact('aws-sqs', asNodeId('source'), asNodeId('target'), {
        sourceNodeId: asNodeId('source'),
        targetNodeId: asNodeId('target'),
        endpoint: 'redrive_policy',
        deadLetterTargetArn: 'arn:aws:sqs:eu-west-2:123456789012:target',
        resolutionMode: 'target_arn',
      }),
    ).toMatchObject({
      attributes: {
        connector: 'aws_sqs_queue',
        endpoint: 'redrive_policy',
        deadLetterTargetArn: 'arn:aws:sqs:eu-west-2:123456789012:target',
        resolutionMode: 'target_arn',
      },
    });
    expect(
      __testing.deadLetterFact('aws-sqs', asNodeId('source'), asNodeId('target'), {
        sourceNodeId: asNodeId('source'),
        targetNodeId: asNodeId('target'),
        endpoint: 'redrive_policy',
        deadLetterTargetArn: 'arn:aws:sqs:eu-west-2:123456789012:target',
        resolutionMode: 'target_arn',
      }).attributes,
    ).not.toHaveProperty('sourceInstanceAddress');
  });

  it('should resolve dead-letter mappings across all resolution modes', () => {
    const sourceQueueId = asNodeId('source');
    const targetQueueId = asNodeId('target');
    const fallbackQueueId = asNodeId('fallback');
    const ghostQueueId = asNodeId('ghost');
    const sourceQueueNode = {
      terraform: {
        resource: 'aws_sqs_queue',
        configuration: {
          expressions: {
            redrive_policy: {
              references: ['aws_sqs_queue.target'],
            },
          },
        },
        state: {
          effective: {
            address: 'aws_sqs_queue.source["abi"]',
            values: {
              name: 'source',
              redrive_policy: JSON.stringify({
                deadLetterTargetArn: 'arn:aws:sqs:eu-west-2:123456789012:target',
              }),
            },
          },
          instances: [
            {
              address: 'aws_sqs_queue.source["mei"]',
              values: {
                name: 'source-mei',
                redrive_policy: JSON.stringify({
                  deadLetterTargetArn: 'arn:aws:sqs:eu-west-2:123456789012:target-by-name',
                }),
              },
            },
            {
              address: 'aws_sqs_queue.source["mti"]',
              values: {
                name: 'source-mti',
                redrive_policy: JSON.stringify({
                  deadLetterTargetArn: 'arn:aws:sqs:eu-west-2:123456789012:missing',
                }),
              },
            },
            {
              address: 'aws_sqs_queue.source["cfg"]',
              values: {
                name: 'source-cfg',
              },
            },
          ],
        },
      },
    } as never;

    const targetQueueNode = {
      terraform: {
        resource: 'aws_sqs_queue',
        state: {
          effective: {
            address: 'aws_sqs_queue.target',
            values: {
              name: 'target-by-name',
              arn: 'arn:aws:sqs:eu-west-2:123456789012:target',
              redrive_allow_policy: JSON.stringify({
                sourceQueueArns: [
                  'arn:aws:sqs:eu-west-2:123456789012:source',
                  'arn:aws:sqs:eu-west-2:123456789012:ghost',
                  'arn:aws:sqs:eu-west-2:123456789012:target',
                ],
              }),
            },
          },
          instances: [],
        },
      },
    } as never;

    const graph = createMockGraph(
      {
        [sourceQueueId]: sourceQueueNode,
        [targetQueueId]: targetQueueNode,
        [fallbackQueueId]: {
          terraform: {
            resource: 'aws_sqs_queue',
          },
        },
      },
      [{ id: 'source-fallback', from: String(sourceQueueId), to: String(fallbackQueueId) }],
    );

    const mappings = __testing.collectDeadLetterMappings(
      graph,
      sourceQueueId,
      sourceQueueNode,
      new Map([
        ['arn:aws:sqs:eu-west-2:123456789012:target', targetQueueId],
        ['arn:aws:sqs:eu-west-2:123456789012:ghost', ghostQueueId],
      ]),
      new Map([['target-by-name', targetQueueId]]),
      new Map([['aws_sqs_queue.target', targetQueueId]]),
    );

    expect(mappings.map((mapping) => mapping.resolutionMode).sort()).toStrictEqual([
      'configuration_ref',
      'graph_fallback',
      'queue_name',
      'target_arn',
    ]);
    expect(
      mappings.find((mapping) => mapping.resolutionMode === 'configuration_ref')?.targetQueueName,
    ).toBe('target-by-name');

    const allowMappings = __testing.collectDeadLetterMappings(
      createMockGraph(
        {
          [sourceQueueId]: {
            ...sourceQueueNode,
            terraform: {
              ...sourceQueueNode.terraform,
              state: {
                ...sourceQueueNode.terraform.state,
                effective: {
                  ...sourceQueueNode.terraform.state.effective,
                  values: {
                    name: 'source',
                    arn: 'arn:aws:sqs:eu-west-2:123456789012:source',
                  },
                },
              },
            },
          },
          [targetQueueId]: targetQueueNode,
        },
        [],
      ),
      targetQueueId,
      targetQueueNode,
      new Map([
        ['arn:aws:sqs:eu-west-2:123456789012:source', sourceQueueId],
        ['arn:aws:sqs:eu-west-2:123456789012:target', targetQueueId],
        ['arn:aws:sqs:eu-west-2:123456789012:ghost', ghostQueueId],
      ]),
      new Map([['source', sourceQueueId]]),
      new Map(),
    );

    expect(
      allowMappings.find((mapping) => mapping.endpoint === 'redrive_allow_policy'),
    ).toMatchObject({
      sourceNodeId: sourceQueueId,
      targetNodeId: targetQueueId,
    });

    expect(
      __testing.deadLetterFact(AwsSqsDeadLetterSemanticDecorator.id, sourceQueueId, targetQueueId, {
        sourceNodeId: sourceQueueId,
        targetNodeId: targetQueueId,
        deadLetterTargetArn: 'arn:aws:sqs:eu-west-2:123456789012:target',
        resolutionMode: 'target_arn',
        endpoint: 'redrive_policy',
        sourceInstanceAddress: 'aws_sqs_queue.source["abi"]',
        sourceInstanceKey: 'abi',
      }),
    ).toMatchObject({
      kind: 'dead_letters_to',
      attributes: {
        connector: 'aws_sqs_queue',
        sourceInstanceKey: 'abi',
      },
    });
  });

  it('should select projection ids and project onto existing edges', () => {
    const sourceQueueId = asNodeId('source');
    const targetQueueId = asNodeId('target');
    const sourceProjectionId = asNodeId('projection-source');
    const targetProjectionId = asNodeId('projection-target');
    const otherProjectionId = asNodeId('projection-other');

    const graph = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [sourceQueueId]: {
          id: sourceQueueId,
        },
        [targetQueueId]: {
          id: targetQueueId,
        },
        [sourceProjectionId]: {
          id: sourceProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.sqs:source',
            label: 'source',
            derivation: {
              source: 'plugin',
              projectionName: 'aws.sqs',
              rootNodeId: sourceQueueId,
              instanceKey: 'abi',
              rootInstanceAddress: 'aws_sqs_queue.source["abi"]',
            },
          },
        },
        [targetProjectionId]: {
          id: targetProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.sqs:target',
            label: 'target',
            derivation: {
              source: 'plugin',
              projectionName: 'aws.sqs',
              rootNodeId: targetQueueId,
              instanceKey: 'abi',
            },
          },
        },
        [otherProjectionId]: {
          id: otherProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.lambda:other',
            label: 'other',
            derivation: {
              source: 'plugin',
              projectionName: 'aws.lambda',
              rootNodeId: targetQueueId,
            },
          },
        },
      },
      edges: [
        {
          id: asEdgeId('raw-fact'),
          from: sourceQueueId,
          to: targetQueueId,
          attributes: {
            semantic: {
              facts: [
                {
                  kind: 'dead_letters_to',
                  from: sourceQueueId,
                  to: targetQueueId,
                  source: 'explicit_connection',
                  confidence: 'exact',
                  decorator: AwsSqsDeadLetterSemanticDecorator.id,
                  attributes: {
                    sourceInstanceKey: 'abi',
                    sourceInstanceAddress: 'aws_sqs_queue.source["abi"]',
                  },
                },
              ],
            },
          },
        },
        {
          id: asEdgeId('existing-projection-edge'),
          from: sourceProjectionId,
          to: targetProjectionId,
          attributes: {
            projection: {
              layer: 'core',
            },
          },
        },
      ],
    });

    expect(
      __testing.filterSqsProjectionIds(graph, [sourceProjectionId, otherProjectionId]),
    ).toStrictEqual([sourceProjectionId]);
    expect(
      __testing.selectProjectionIdsForFact(graph, [otherProjectionId], {
        preferredInstanceKey: 'abi',
      }),
    ).toStrictEqual([]);
    expect(
      __testing.selectProjectionIdsForFact(graph, [sourceProjectionId], {
        preferredInstanceAddress: 'aws_sqs_queue.source["abi"]',
      }),
    ).toStrictEqual([sourceProjectionId]);
    expect(
      __testing.selectProjectionIdsForFact(graph, [sourceProjectionId, targetProjectionId], {}),
    ).toStrictEqual([]);

    const projected = new AwsSqsDeadLetterSemanticDecorator().project({ graph });
    expect(
      projected.getEdgeAttributes(asEdgeId('existing-projection-edge'))?.projection?.semantics
        ?.facts?.[0],
    ).toMatchObject({
      kind: 'dead_letters_to',
      from: sourceProjectionId,
      to: targetProjectionId,
    });
  });
});
