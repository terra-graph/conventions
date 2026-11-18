import { GraphologyAdapter, TG_SCHEMA_VERSION, type TgGraph, asNodeId } from '@terra-graph/core';
import { DirectedGraph } from 'graphology';
import { AwsPipeSemanticDecorator, __testing } from './AwsPipeSemanticDecorator.js';

const buildAdapter = (graph: TgGraph) =>
  new GraphologyAdapter(
    new DirectedGraph() as unknown as ConstructorParameters<typeof GraphologyAdapter>[0],
  ).withTgGraph(graph);

describe('AwsPipeSemanticDecorator internals', () => {
  it('should resolve pipe helpers', () => {
    expect(
      __testing.resolvePipeEndpointArn(
        {
          terraform: {
            state: {
              effective: {
                values: {
                  source: 'arn:aws:sqs:eu-west-2:123456789012:source',
                },
              },
            },
          },
        } as never,
        'source',
      ),
    ).toBe('arn:aws:sqs:eu-west-2:123456789012:source');
    expect(__testing.resolvePipeEndpointArn({} as never, 'target')).toBeUndefined();
    expect(
      __testing.pipeFact(
        AwsPipeSemanticDecorator.id,
        'feeds',
        asNodeId('source'),
        asNodeId('pipe'),
        'source',
      ),
    ).toMatchObject({
      kind: 'feeds',
      source: 'explicit_connection',
      confidence: 'exact',
      attributes: {
        connector: 'aws_pipes_pipe',
        endpoint: 'source',
      },
    });
  });

  it('should skip missing nodes and unresolved endpoints during extract', () => {
    const pipeId = asNodeId('pipe');
    const queueId = asNodeId('queue');
    const graph: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [pipeId]: {
          id: pipeId,
          terraform: {
            kind: 'resource',
            address: 'aws_pipes_pipe.example',
            resource: 'aws_pipes_pipe',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_pipes_pipe.example',
                values: {
                  source: 'aws_sqs_queue.source',
                },
              },
              instances: [],
            },
          },
        },
        [queueId]: {
          id: queueId,
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
              instances: [],
            },
          },
        },
      },
      edges: [],
    };

    const adapter = buildAdapter(graph);
    const originalNodeIds = adapter.nodeIds.bind(adapter);
    const originalGetNodeAttributes = adapter.getNodeAttributes.bind(adapter);

    jest
      .spyOn(adapter, 'nodeIds')
      .mockImplementation(() => [...originalNodeIds(), asNodeId('ghost')]);
    jest.spyOn(adapter, 'getNodeAttributes').mockImplementation((nodeId) => {
      if (String(nodeId) === 'ghost') {
        return undefined;
      }
      return originalGetNodeAttributes(nodeId);
    });

    const extracted = new AwsPipeSemanticDecorator().extract({ graph: adapter });
    const feedEdge = extracted
      .outEdges(queueId)
      .find((edgeId) =>
        extracted.getEdgeAttributes(edgeId)?.semantic?.facts?.some((fact) => fact.kind === 'feeds'),
      );

    expect(feedEdge).toBeDefined();
    expect(
      extracted
        .outEdges(pipeId)
        .some((edgeId) =>
          extracted
            .getEdgeAttributes(edgeId)
            ?.semantic?.facts?.some((fact) => fact.kind === 'delivers_to'),
        ),
    ).toBe(false);
  });
});
