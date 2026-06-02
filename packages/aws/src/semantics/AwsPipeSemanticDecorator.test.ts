import {
  GraphologyAdapter,
  TG_SCHEMA_VERSION,
  type TgGraph,
  asEdgeId,
  asNodeId,
} from '@terra-graph/core';
import { DirectedGraph } from 'graphology';
import { AwsPipeSemanticDecorator } from './AwsPipeSemanticDecorator.js';

describe('AwsPipeSemanticDecorator', () => {
  it('should derive pipe semantic facts from explicit source and target arns and project them onto existing projection edges', () => {
    const queueId = asNodeId('queue');
    const pipeId = asNodeId('pipe');
    const stateMachineId = asNodeId('state-machine');
    const queueProjectionId = asNodeId('projection-queue');
    const pipeProjectionId = asNodeId('projection-pipe');
    const stateMachineProjectionId = asNodeId('projection-state-machine');
    const rawSourceEdgeId = asEdgeId('pipe->queue');
    const rawTargetEdgeId = asEdgeId('pipe->state-machine');
    const projectedSourceEdgeId = asEdgeId('projection-queue->projection-pipe');
    const projectedTargetEdgeId = asEdgeId(
      'projection-pipe->projection-state-machine',
    );

    const graph: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [queueId]: {
          id: queueId,
          terraform: {
            kind: 'resource',
            address: 'aws_sqs_queue.event_queue',
            resource: 'aws_sqs_queue',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_sqs_queue.event_queue',
                values: {
                  arn: 'arn:aws:sqs:eu-west-2:123456789012:event-queue',
                },
              },
              instances: [],
            },
          },
        },
        [pipeId]: {
          id: pipeId,
          terraform: {
            kind: 'resource',
            address: 'aws_pipes_pipe.event_pipe',
            resource: 'aws_pipes_pipe',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_pipes_pipe.event_pipe',
                values: {
                  source: 'arn:aws:sqs:eu-west-2:123456789012:event-queue',
                  target:
                    'arn:aws:states:eu-west-2:123456789012:stateMachine:event-flow',
                },
              },
              instances: [],
            },
          },
        },
        [stateMachineId]: {
          id: stateMachineId,
          terraform: {
            kind: 'resource',
            address: 'aws_sfn_state_machine.event_flow',
            resource: 'aws_sfn_state_machine',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_sfn_state_machine.event_flow',
                values: {
                  arn: 'arn:aws:states:eu-west-2:123456789012:stateMachine:event-flow',
                },
              },
              instances: [],
            },
          },
        },
        [queueProjectionId]: {
          id: queueProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.sqs:event_queue',
            label: 'event_queue',
            derivation: {
              source: 'plugin',
              rootNodeId: queueId,
            },
          },
        },
        [pipeProjectionId]: {
          id: pipeProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.eventbridge_pipe:event_pipe',
            label: 'event_pipe',
            derivation: {
              source: 'plugin',
              rootNodeId: pipeId,
            },
          },
        },
        [stateMachineProjectionId]: {
          id: stateMachineProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.step_function:event_flow',
            label: 'event_flow',
            derivation: {
              source: 'plugin',
              rootNodeId: stateMachineId,
            },
          },
        },
      },
      edges: [
        {
          id: rawSourceEdgeId,
          from: pipeId,
          to: queueId,
          attributes: {},
        },
        {
          id: rawTargetEdgeId,
          from: pipeId,
          to: stateMachineId,
          attributes: {},
        },
        {
          id: projectedSourceEdgeId,
          from: queueProjectionId,
          to: pipeProjectionId,
          attributes: {
            projection: {
              layer: 'core',
              relationship: {
                relation: 'triggers',
                source: 'derived',
              },
            },
          },
        },
        {
          id: projectedTargetEdgeId,
          from: pipeProjectionId,
          to: stateMachineProjectionId,
          attributes: {
            projection: {
              layer: 'core',
              relationship: {
                relation: 'invokes',
                source: 'derived',
              },
            },
          },
        },
      ],
    };

    const adapter = new GraphologyAdapter(
      new DirectedGraph() as unknown as ConstructorParameters<
        typeof GraphologyAdapter
      >[0],
    ).withTgGraph(graph);
    const decorator = new AwsPipeSemanticDecorator();

    const extracted = decorator.extract({ graph: adapter });
    expect(
      extracted.getEdgeAttributes(rawSourceEdgeId)?.semantic?.facts?.[0],
    ).toMatchObject({
      kind: 'feeds',
      from: queueId,
      to: pipeId,
      decorator: AwsPipeSemanticDecorator.id,
    });
    expect(
      extracted.getEdgeAttributes(rawTargetEdgeId)?.semantic?.facts?.[0],
    ).toMatchObject({
      kind: 'delivers_to',
      from: pipeId,
      to: stateMachineId,
      decorator: AwsPipeSemanticDecorator.id,
    });

    const projected = decorator.project({ graph: extracted });
    expect(
      projected.getEdgeAttributes(projectedSourceEdgeId)?.projection?.semantics
        ?.facts?.[0],
    ).toMatchObject({
      kind: 'feeds',
      from: queueProjectionId,
      to: pipeProjectionId,
      attributes: {
        rawFrom: queueId,
        rawTo: pipeId,
      },
    });
    expect(
      projected.getEdgeAttributes(projectedTargetEdgeId)?.projection?.semantics
        ?.facts?.[0],
    ).toMatchObject({
      kind: 'delivers_to',
      from: pipeProjectionId,
      to: stateMachineProjectionId,
      attributes: {
        rawFrom: pipeId,
        rawTo: stateMachineId,
      },
    });
  });

  it('should create projection edges from semantic facts when none exist', () => {
    const queueId = asNodeId('queue');
    const pipeId = asNodeId('pipe');
    const stateMachineId = asNodeId('state-machine');
    const queueProjectionId = asNodeId('projection-queue');
    const pipeProjectionId = asNodeId('projection-pipe');
    const stateMachineProjectionId = asNodeId('projection-state-machine');

    const graph: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [queueId]: {
          id: queueId,
          terraform: {
            kind: 'resource',
            address: 'aws_sqs_queue.event_queue',
            resource: 'aws_sqs_queue',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_sqs_queue.event_queue',
                values: {
                  arn: 'arn:aws:sqs:eu-west-2:123456789012:event-queue',
                },
              },
              instances: [],
            },
          },
        },
        [pipeId]: {
          id: pipeId,
          terraform: {
            kind: 'resource',
            address: 'aws_pipes_pipe.event_pipe',
            resource: 'aws_pipes_pipe',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_pipes_pipe.event_pipe',
                values: {
                  source: 'arn:aws:sqs:eu-west-2:123456789012:event-queue',
                  target:
                    'arn:aws:states:eu-west-2:123456789012:stateMachine:event-flow',
                },
              },
              instances: [],
            },
          },
        },
        [stateMachineId]: {
          id: stateMachineId,
          terraform: {
            kind: 'resource',
            address: 'aws_sfn_state_machine.event_flow',
            resource: 'aws_sfn_state_machine',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_sfn_state_machine.event_flow',
                values: {
                  arn: 'arn:aws:states:eu-west-2:123456789012:stateMachine:event-flow',
                },
              },
              instances: [],
            },
          },
        },
        [queueProjectionId]: {
          id: queueProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.sqs:event_queue',
            label: 'event_queue',
            derivation: {
              source: 'plugin',
              rootNodeId: queueId,
            },
          },
        },
        [pipeProjectionId]: {
          id: pipeProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.eventbridge_pipe:event_pipe',
            label: 'event_pipe',
            derivation: {
              source: 'plugin',
              rootNodeId: pipeId,
            },
          },
        },
        [stateMachineProjectionId]: {
          id: stateMachineProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.step_function:event_flow',
            label: 'event_flow',
            derivation: {
              source: 'plugin',
              rootNodeId: stateMachineId,
            },
          },
        },
      },
      edges: [],
    };

    const adapter = new GraphologyAdapter(
      new DirectedGraph() as unknown as ConstructorParameters<
        typeof GraphologyAdapter
      >[0],
    ).withTgGraph(graph);
    const decorator = new AwsPipeSemanticDecorator();

    const extracted = decorator.extract({ graph: adapter });
    expect(extracted.edgesBetween(queueId, pipeId)).toHaveLength(1);
    expect(extracted.edgesBetween(pipeId, stateMachineId)).toHaveLength(1);
    const projected = decorator.project({ graph: extracted });

    expect(projected.edgesBetween(queueProjectionId, pipeProjectionId)).toHaveLength(
      1,
    );
    expect(
      projected.edgesBetween(pipeProjectionId, stateMachineProjectionId),
    ).toHaveLength(1);
  });
});
