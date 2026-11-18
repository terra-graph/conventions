import {
  type AdapterOperations,
  GraphologyAdapter,
  type NodeId,
  TG_SCHEMA_VERSION,
  type TgGraph,
  asEdgeId,
  asNodeId,
} from '@terra-graph/core';
import { DirectedGraph } from 'graphology';
import { AwsSqsDeadLetterSemanticDecorator } from './AwsSqsDeadLetterSemanticDecorator.js';

const buildAdapter = (graph: TgGraph) =>
  new GraphologyAdapter(
    new DirectedGraph() as unknown as ConstructorParameters<typeof GraphologyAdapter>[0],
  ).withTgGraph(graph);

const findFactEdge = (graph: AdapterOperations, nodeId: NodeId, kind: string) =>
  graph
    .outEdges(nodeId)
    .find((edgeId) =>
      graph.getEdgeAttributes(edgeId)?.semantic?.facts?.some((fact) => fact.kind === kind),
    );

const requireDefined = <T>(value: T | undefined): T => {
  expect(value).toBeDefined();
  if (value === undefined) {
    throw new Error('Expected value to be defined');
  }
  return value;
};

describe('AwsSqsDeadLetterSemanticDecorator', () => {
  it('should derive dead_letters_to facts from queue redrive policies and project them onto queue projections', () => {
    const sourceQueueId = asNodeId('source-queue');
    const deadLetterQueueId = asNodeId('dead-letter-queue');
    const sourceProjectionId = asNodeId('projection-source-queue');
    const deadLetterProjectionId = asNodeId('projection-dead-letter-queue');

    const graph: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [sourceQueueId]: {
          id: sourceQueueId,
          terraform: {
            kind: 'resource',
            address: 'aws_sqs_queue.source',
            resource: 'aws_sqs_queue',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_sqs_queue.source',
                values: {
                  name: 'source-queue',
                  redrive_policy: JSON.stringify({
                    deadLetterTargetArn: 'arn:aws:sqs:eu-west-2:123456789012:source-dlq',
                  }),
                },
              },
              instances: [],
            },
          },
        },
        [deadLetterQueueId]: {
          id: deadLetterQueueId,
          terraform: {
            kind: 'resource',
            address: 'aws_sqs_queue.dead_letter',
            resource: 'aws_sqs_queue',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_sqs_queue.dead_letter',
                values: {
                  arn: 'arn:aws:sqs:eu-west-2:123456789012:source-dlq',
                  name: 'source-dlq',
                },
              },
              instances: [],
            },
          },
        },
        [sourceProjectionId]: {
          id: sourceProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.sqs:source',
            label: 'source',
            derivation: {
              source: 'profile',
              projectionName: 'aws.sqs',
              rootNodeId: sourceQueueId,
            },
          },
        },
        [deadLetterProjectionId]: {
          id: deadLetterProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.sqs:dead_letter',
            label: 'dead_letter',
            derivation: {
              source: 'profile',
              projectionName: 'aws.sqs',
              rootNodeId: deadLetterQueueId,
            },
          },
        },
      },
      edges: [],
    };

    const decorator = new AwsSqsDeadLetterSemanticDecorator();

    const extracted = decorator.extract({ graph: buildAdapter(graph) });
    const rawFactEdgeId = findFactEdge(extracted, sourceQueueId, 'dead_letters_to');
    const factEdgeId = requireDefined(rawFactEdgeId);
    expect(extracted.getEdgeAttributes(factEdgeId)?.semantic?.facts?.[0]).toMatchObject({
      kind: 'dead_letters_to',
      from: sourceQueueId,
      to: deadLetterQueueId,
      source: 'explicit_connection',
      confidence: 'exact',
      attributes: {
        connector: 'aws_sqs_queue',
        endpoint: 'redrive_policy',
        deadLetterTargetArn: 'arn:aws:sqs:eu-west-2:123456789012:source-dlq',
        resolutionMode: 'target_arn',
      },
    });

    const projected = decorator.project({ graph: extracted });
    const projectedEdgeId = projected
      .outEdges(sourceProjectionId)
      .find((edgeId) =>
        projected
          .getEdgeAttributes(edgeId)
          ?.projection?.semantics?.facts?.some((fact) => fact.kind === 'dead_letters_to'),
      );

    const definedProjectedEdgeId = requireDefined(projectedEdgeId);
    expect(projected.edgeTarget(definedProjectedEdgeId)).toBe(deadLetterProjectionId);
    expect(
      projected.getEdgeAttributes(definedProjectedEdgeId)?.projection?.semantics?.facts?.[0],
    ).toMatchObject({
      kind: 'dead_letters_to',
      from: sourceProjectionId,
      to: deadLetterProjectionId,
      attributes: {
        rawFrom: sourceQueueId,
        rawTo: deadLetterQueueId,
      },
    });
  });

  it('should pair queue and dlq projections by instance key when projecting instance-backed queues', () => {
    const sourceQueueId = asNodeId('source-queue-root');
    const deadLetterQueueId = asNodeId('dead-letter-queue-root');
    const sourceBlueProjectionId = asNodeId('projection-source-blue');
    const sourceGreenProjectionId = asNodeId('projection-source-green');
    const deadLetterBlueProjectionId = asNodeId('projection-dead-letter-blue');
    const deadLetterGreenProjectionId = asNodeId('projection-dead-letter-green');

    const graph: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [sourceQueueId]: {
          id: sourceQueueId,
          terraform: {
            kind: 'resource',
            address: 'aws_sqs_queue.source',
            resource: 'aws_sqs_queue',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_sqs_queue.source',
                values: {},
              },
              instances: [
                {
                  address: 'aws_sqs_queue.source["blue"]',
                  values: {
                    name: 'source-blue',
                    redrive_policy: JSON.stringify({
                      deadLetterTargetArn: 'arn:aws:sqs:eu-west-2:123456789012:dead-letter-blue',
                    }),
                  },
                },
                {
                  address: 'aws_sqs_queue.source["green"]',
                  values: {
                    name: 'source-green',
                    redrive_policy: JSON.stringify({
                      deadLetterTargetArn: 'arn:aws:sqs:eu-west-2:123456789012:dead-letter-green',
                    }),
                  },
                },
              ],
            },
          },
        },
        [deadLetterQueueId]: {
          id: deadLetterQueueId,
          terraform: {
            kind: 'resource',
            address: 'aws_sqs_queue.dead_letter',
            resource: 'aws_sqs_queue',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_sqs_queue.dead_letter',
                values: {},
              },
              instances: [
                {
                  address: 'aws_sqs_queue.dead_letter["blue"]',
                  values: {
                    arn: 'arn:aws:sqs:eu-west-2:123456789012:dead-letter-blue',
                    name: 'dead-letter-blue',
                  },
                },
                {
                  address: 'aws_sqs_queue.dead_letter["green"]',
                  values: {
                    arn: 'arn:aws:sqs:eu-west-2:123456789012:dead-letter-green',
                    name: 'dead-letter-green',
                  },
                },
              ],
            },
          },
        },
        [sourceBlueProjectionId]: {
          id: sourceBlueProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.sqs:source["blue"]',
            label: 'source["blue"]',
            derivation: {
              source: 'profile',
              projectionName: 'aws.sqs',
              rootNodeId: sourceQueueId,
              rootInstanceAddress: 'aws_sqs_queue.source["blue"]',
              instanceKey: 'blue',
            },
          },
        },
        [sourceGreenProjectionId]: {
          id: sourceGreenProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.sqs:source["green"]',
            label: 'source["green"]',
            derivation: {
              source: 'profile',
              projectionName: 'aws.sqs',
              rootNodeId: sourceQueueId,
              rootInstanceAddress: 'aws_sqs_queue.source["green"]',
              instanceKey: 'green',
            },
          },
        },
        [deadLetterBlueProjectionId]: {
          id: deadLetterBlueProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.sqs:dead_letter["blue"]',
            label: 'dead_letter["blue"]',
            derivation: {
              source: 'profile',
              projectionName: 'aws.sqs',
              rootNodeId: deadLetterQueueId,
              rootInstanceAddress: 'aws_sqs_queue.dead_letter["blue"]',
              instanceKey: 'blue',
            },
          },
        },
        [deadLetterGreenProjectionId]: {
          id: deadLetterGreenProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.sqs:dead_letter["green"]',
            label: 'dead_letter["green"]',
            derivation: {
              source: 'profile',
              projectionName: 'aws.sqs',
              rootNodeId: deadLetterQueueId,
              rootInstanceAddress: 'aws_sqs_queue.dead_letter["green"]',
              instanceKey: 'green',
            },
          },
        },
      },
      edges: [],
    };

    const decorator = new AwsSqsDeadLetterSemanticDecorator();

    const extracted = decorator.extract({ graph: buildAdapter(graph) });
    const projected = decorator.project({ graph: extracted });

    const blueTargets = projected
      .outEdges(sourceBlueProjectionId)
      .map((edgeId) => projected.edgeTarget(edgeId));
    const greenTargets = projected
      .outEdges(sourceGreenProjectionId)
      .map((edgeId) => projected.edgeTarget(edgeId));

    expect(blueTargets).toContain(deadLetterBlueProjectionId);
    expect(blueTargets).not.toContain(deadLetterGreenProjectionId);
    expect(greenTargets).toContain(deadLetterGreenProjectionId);
    expect(greenTargets).not.toContain(deadLetterBlueProjectionId);
  });

  it('should derive dead_letters_to facts from dlq redrive_allow_policy when source redrive_policy is not visible in state', () => {
    const sourceQueueId = asNodeId('source-queue-from-allow-policy');
    const deadLetterQueueId = asNodeId('dead-letter-queue-from-allow-policy');
    const sourceProjectionId = asNodeId('projection-source-queue-from-allow-policy');
    const deadLetterProjectionId = asNodeId('projection-dead-letter-queue-from-allow-policy');

    const graph: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [sourceQueueId]: {
          id: sourceQueueId,
          terraform: {
            kind: 'resource',
            address: 'aws_sqs_queue.source',
            resource: 'aws_sqs_queue',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_sqs_queue.source',
                values: {
                  name: 'source-queue',
                },
              },
              instances: [],
            },
          },
        },
        [deadLetterQueueId]: {
          id: deadLetterQueueId,
          terraform: {
            kind: 'resource',
            address: 'aws_sqs_queue.dead_letter',
            resource: 'aws_sqs_queue',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_sqs_queue.dead_letter',
                values: {
                  arn: 'arn:aws:sqs:eu-west-2:123456789012:source-queue-dlq',
                  name: 'source-queue-dlq',
                  redrive_allow_policy: JSON.stringify({
                    redrivePermission: 'byQueue',
                    sourceQueueArns: ['arn:aws:sqs:eu-west-2:123456789012:source-queue'],
                  }),
                },
              },
              instances: [],
            },
          },
        },
        [sourceProjectionId]: {
          id: sourceProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.sqs:source',
            label: 'source',
            derivation: {
              source: 'profile',
              projectionName: 'aws.sqs',
              rootNodeId: sourceQueueId,
            },
          },
        },
        [deadLetterProjectionId]: {
          id: deadLetterProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.sqs:dead_letter',
            label: 'dead_letter',
            derivation: {
              source: 'profile',
              projectionName: 'aws.sqs',
              rootNodeId: deadLetterQueueId,
            },
          },
        },
      },
      edges: [],
    };

    const decorator = new AwsSqsDeadLetterSemanticDecorator();

    const extracted = decorator.extract({ graph: buildAdapter(graph) });
    const rawFactEdgeId = findFactEdge(extracted, sourceQueueId, 'dead_letters_to');
    const factEdgeId = requireDefined(rawFactEdgeId);
    expect(extracted.getEdgeAttributes(factEdgeId)?.semantic?.facts?.[0]).toMatchObject({
      kind: 'dead_letters_to',
      from: sourceQueueId,
      to: deadLetterQueueId,
      attributes: {
        endpoint: 'redrive_allow_policy',
        deadLetterTargetArn: 'arn:aws:sqs:eu-west-2:123456789012:source-queue-dlq',
      },
    });

    const projected = decorator.project({ graph: extracted });
    const projectedEdgeId = projected
      .outEdges(sourceProjectionId)
      .find((edgeId) =>
        projected
          .getEdgeAttributes(edgeId)
          ?.projection?.semantics?.facts?.some((fact) => fact.kind === 'dead_letters_to'),
      );

    const definedProjectedEdgeId = requireDefined(projectedEdgeId);
    expect(projected.edgeTarget(definedProjectedEdgeId)).toBe(deadLetterProjectionId);
  });

  it('should derive dead_letters_to facts from redrive_policy configuration references when state values are not materialized', () => {
    const sourceQueueId = asNodeId('source-queue-from-config-ref');
    const deadLetterQueueId = asNodeId('dead-letter-queue-from-config-ref');
    const sourceProjectionId = asNodeId('projection-source-queue-from-config-ref');
    const deadLetterProjectionId = asNodeId('projection-dead-letter-queue-from-config-ref');

    const graph: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [sourceQueueId]: {
          id: sourceQueueId,
          terraform: {
            kind: 'resource',
            address: 'aws_sqs_queue.source',
            resource: 'aws_sqs_queue',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_sqs_queue.source',
                values: {
                  name: 'source-queue',
                },
              },
              instances: [],
            },
            configuration: {
              source: 'plan_show',
              expressions: {
                redrive_policy: {
                  references: ['aws_sqs_queue.dead_letter.arn', 'aws_sqs_queue.dead_letter'],
                },
              },
            },
          },
        },
        [deadLetterQueueId]: {
          id: deadLetterQueueId,
          terraform: {
            kind: 'resource',
            address: 'aws_sqs_queue.dead_letter',
            resource: 'aws_sqs_queue',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_sqs_queue.dead_letter',
                values: {
                  name: 'source-queue-dlq',
                },
              },
              instances: [],
            },
          },
        },
        [sourceProjectionId]: {
          id: sourceProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.sqs:source',
            label: 'source',
            derivation: {
              source: 'profile',
              projectionName: 'aws.sqs',
              rootNodeId: sourceQueueId,
            },
          },
        },
        [deadLetterProjectionId]: {
          id: deadLetterProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.sqs:dead_letter',
            label: 'dead_letter',
            derivation: {
              source: 'profile',
              projectionName: 'aws.sqs',
              rootNodeId: deadLetterQueueId,
            },
          },
        },
      },
      edges: [],
    };

    const decorator = new AwsSqsDeadLetterSemanticDecorator();

    const extracted = decorator.extract({ graph: buildAdapter(graph) });
    const rawFactEdgeId = findFactEdge(extracted, sourceQueueId, 'dead_letters_to');
    const factEdgeId = requireDefined(rawFactEdgeId);
    expect(extracted.getEdgeAttributes(factEdgeId)?.semantic?.facts?.[0]).toMatchObject({
      kind: 'dead_letters_to',
      from: sourceQueueId,
      to: deadLetterQueueId,
      attributes: {
        endpoint: 'redrive_policy',
        resolutionMode: 'configuration_ref',
      },
    });

    const projected = decorator.project({ graph: extracted });
    const projectedEdgeId = projected
      .outEdges(sourceProjectionId)
      .find((edgeId) =>
        projected
          .getEdgeAttributes(edgeId)
          ?.projection?.semantics?.facts?.some((fact) => fact.kind === 'dead_letters_to'),
      );

    const definedProjectedEdgeId = requireDefined(projectedEdgeId);
    expect(projected.edgeTarget(definedProjectedEdgeId)).toBe(deadLetterProjectionId);
  });
});
