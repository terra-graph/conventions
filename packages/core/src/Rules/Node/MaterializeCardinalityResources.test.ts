import {
  GraphResolver,
  GraphologyAdapter,
  TG_SCHEMA_VERSION,
  type TgGraph,
  edgeIdFrom,
  tgNodeIdFrom,
} from '@terra-graph/core';
import { MaterializeCardinalityResources } from './MaterializeCardinalityResources.js';

const resolve = (graph: TgGraph): TgGraph => {
  const rule = new MaterializeCardinalityResources({
    node: {
      any: true,
    },
  });
  const resolver = new GraphResolver(new GraphologyAdapter());

  return resolver.resolve({ graph, phases: [[rule]] }).toTgGraph();
};

describe('MaterializeCardinalityResources', () => {
  it('should keep graphs without cardinality families unchanged', () => {
    const source = tgNodeIdFrom('resource', 'aws_sqs_queue.source');
    const target = tgNodeIdFrom('resource', 'aws_lambda_function.target');
    const graph: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [source]: {
          id: source,
          terraform: {
            kind: 'resource',
            address: 'aws_sqs_queue.source',
            resource: 'aws_sqs_queue',
            name: 'source',
          },
        },
        [target]: {
          id: target,
          terraform: {
            kind: 'resource',
            address: 'aws_lambda_function.target',
            resource: 'aws_lambda_function',
            name: 'target',
          },
        },
      },
      edges: [
        {
          id: edgeIdFrom(source, target),
          from: source,
          to: target,
          attributes: {},
        },
      ],
    };

    expect(resolve(graph)).toEqual(graph);
  });

  it('should materialize keyed sibling edges and remove family nodes', () => {
    const channelFamily = tgNodeIdFrom('resource', 'aws_sqs_queue.channel');
    const channelBlue = tgNodeIdFrom('resource', 'aws_sqs_queue.channel["blue"]');
    const channelGreen = tgNodeIdFrom('resource', 'aws_sqs_queue.channel["green"]');
    const consumerFamily = tgNodeIdFrom('resource', 'aws_lambda_function.consumer');
    const consumerBlue = tgNodeIdFrom('resource', 'aws_lambda_function.consumer["blue"]');
    const consumerGreen = tgNodeIdFrom('resource', 'aws_lambda_function.consumer["green"]');

    const graph: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [channelFamily]: {
          id: channelFamily,
          terraform: {
            kind: 'resource',
            address: 'aws_sqs_queue.channel',
            resource: 'aws_sqs_queue',
            name: 'channel',
          },
        },
        [channelBlue]: {
          id: channelBlue,
          terraform: {
            kind: 'resource',
            address: 'aws_sqs_queue.channel["blue"]',
            resource: 'aws_sqs_queue',
            name: 'channel["blue"]',
            state: {
              source: 'plan_show',
              effective: null,
              instances: [
                {
                  address: 'aws_sqs_queue.channel["blue"]',
                  index: 'blue',
                  values: null,
                },
                {
                  address: 'aws_sqs_queue.channel["green"]',
                  index: 'green',
                  values: null,
                },
              ],
            },
          },
        },
        [channelGreen]: {
          id: channelGreen,
          terraform: {
            kind: 'resource',
            address: 'aws_sqs_queue.channel["green"]',
            resource: 'aws_sqs_queue',
            name: 'channel["green"]',
            state: {
              source: 'plan_show',
              effective: null,
              instances: [
                {
                  address: 'aws_sqs_queue.channel["blue"]',
                  index: 'blue',
                  values: null,
                },
                {
                  address: 'aws_sqs_queue.channel["green"]',
                  index: 'green',
                  values: null,
                },
              ],
            },
          },
        },
        [consumerFamily]: {
          id: consumerFamily,
          terraform: {
            kind: 'resource',
            address: 'aws_lambda_function.consumer',
            resource: 'aws_lambda_function',
            name: 'consumer',
          },
        },
        [consumerBlue]: {
          id: consumerBlue,
          terraform: {
            kind: 'resource',
            address: 'aws_lambda_function.consumer["blue"]',
            resource: 'aws_lambda_function',
            name: 'consumer["blue"]',
            state: {
              source: 'plan_show',
              effective: null,
              instances: [
                {
                  address: 'aws_lambda_function.consumer["blue"]',
                  index: 'blue',
                  values: null,
                },
                {
                  address: 'aws_lambda_function.consumer["green"]',
                  index: 'green',
                  values: null,
                },
              ],
            },
          },
        },
        [consumerGreen]: {
          id: consumerGreen,
          terraform: {
            kind: 'resource',
            address: 'aws_lambda_function.consumer["green"]',
            resource: 'aws_lambda_function',
            name: 'consumer["green"]',
            state: {
              source: 'plan_show',
              effective: null,
              instances: [
                {
                  address: 'aws_lambda_function.consumer["blue"]',
                  index: 'blue',
                  values: null,
                },
                {
                  address: 'aws_lambda_function.consumer["green"]',
                  index: 'green',
                  values: null,
                },
              ],
            },
          },
        },
      },
      edges: [
        {
          id: edgeIdFrom(channelBlue, channelFamily, 'member'),
          from: channelBlue,
          to: channelFamily,
          attributes: {},
        },
        {
          id: edgeIdFrom(channelGreen, channelFamily, 'member'),
          from: channelGreen,
          to: channelFamily,
          attributes: {},
        },
        {
          id: edgeIdFrom(channelFamily, consumerBlue, 'blue'),
          from: channelFamily,
          to: consumerBlue,
          attributes: { relation: 'routes' },
        },
        {
          id: edgeIdFrom(channelFamily, consumerGreen, 'green'),
          from: channelFamily,
          to: consumerGreen,
          attributes: { relation: 'routes' },
        },
        {
          id: edgeIdFrom(consumerBlue, consumerFamily, 'member'),
          from: consumerBlue,
          to: consumerFamily,
          attributes: {},
        },
        {
          id: edgeIdFrom(consumerGreen, consumerFamily, 'member'),
          from: consumerGreen,
          to: consumerFamily,
          attributes: {},
        },
      ],
    };

    const result = resolve(graph);
    const hasEdge = (from: string, to: string) =>
      result.edges.some((edge) => edge.from === from && edge.to === to);

    expect(result.nodes[channelFamily]).toBeUndefined();
    expect(result.nodes[consumerFamily]).toBeUndefined();
    expect(hasEdge(channelBlue, consumerBlue)).toBe(true);
    expect(hasEdge(channelBlue, consumerGreen)).toBe(false);
    expect(hasEdge(channelGreen, consumerBlue)).toBe(false);
    expect(hasEdge(channelGreen, consumerGreen)).toBe(true);
  });

  it('should fall back to ordinal matching when keyed sets do not align', () => {
    const replayFamily = tgNodeIdFrom('resource', 'aws_sqs_queue.replay');
    const replay0 = tgNodeIdFrom('resource', 'aws_sqs_queue.replay[0]');
    const replay1 = tgNodeIdFrom('resource', 'aws_sqs_queue.replay[1]');
    const deadFamily = tgNodeIdFrom('resource', 'aws_sqs_queue.dead_letter');
    const deadBlue = tgNodeIdFrom('resource', 'aws_sqs_queue.dead_letter["blue"]');
    const deadGreen = tgNodeIdFrom('resource', 'aws_sqs_queue.dead_letter["green"]');

    const graph: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [replayFamily]: {
          id: replayFamily,
          terraform: {
            kind: 'resource',
            address: 'aws_sqs_queue.replay',
            resource: 'aws_sqs_queue',
            name: 'replay',
          },
        },
        [replay0]: {
          id: replay0,
          terraform: {
            kind: 'resource',
            address: 'aws_sqs_queue.replay[0]',
            resource: 'aws_sqs_queue',
            name: 'replay[0]',
          },
        },
        [replay1]: {
          id: replay1,
          terraform: {
            kind: 'resource',
            address: 'aws_sqs_queue.replay[1]',
            resource: 'aws_sqs_queue',
            name: 'replay[1]',
          },
        },
        [deadFamily]: {
          id: deadFamily,
          terraform: {
            kind: 'resource',
            address: 'aws_sqs_queue.dead_letter',
            resource: 'aws_sqs_queue',
            name: 'dead_letter',
          },
        },
        [deadBlue]: {
          id: deadBlue,
          terraform: {
            kind: 'resource',
            address: 'aws_sqs_queue.dead_letter["blue"]',
            resource: 'aws_sqs_queue',
            name: 'dead_letter["blue"]',
            state: {
              source: 'plan_show',
              effective: null,
              instances: [
                {
                  address: 'aws_sqs_queue.dead_letter["blue"]',
                  index: 'blue',
                  values: null,
                },
                {
                  address: 'aws_sqs_queue.dead_letter["green"]',
                  index: 'green',
                  values: null,
                },
              ],
            },
          },
        },
        [deadGreen]: {
          id: deadGreen,
          terraform: {
            kind: 'resource',
            address: 'aws_sqs_queue.dead_letter["green"]',
            resource: 'aws_sqs_queue',
            name: 'dead_letter["green"]',
            state: {
              source: 'plan_show',
              effective: null,
              instances: [
                {
                  address: 'aws_sqs_queue.dead_letter["blue"]',
                  index: 'blue',
                  values: null,
                },
                {
                  address: 'aws_sqs_queue.dead_letter["green"]',
                  index: 'green',
                  values: null,
                },
              ],
            },
          },
        },
      },
      edges: [
        {
          id: edgeIdFrom(replay0, replayFamily, 'member'),
          from: replay0,
          to: replayFamily,
          attributes: {},
        },
        {
          id: edgeIdFrom(replay1, replayFamily, 'member'),
          from: replay1,
          to: replayFamily,
          attributes: {},
        },
        {
          id: edgeIdFrom(replayFamily, deadBlue, 'blue'),
          from: replayFamily,
          to: deadBlue,
          attributes: { relation: 'routes' },
        },
        {
          id: edgeIdFrom(replayFamily, deadGreen, 'green'),
          from: replayFamily,
          to: deadGreen,
          attributes: { relation: 'routes' },
        },
        {
          id: edgeIdFrom(deadBlue, deadFamily, 'member'),
          from: deadBlue,
          to: deadFamily,
          attributes: {},
        },
        {
          id: edgeIdFrom(deadGreen, deadFamily, 'member'),
          from: deadGreen,
          to: deadFamily,
          attributes: {},
        },
      ],
    };

    const result = resolve(graph);
    const hasEdge = (from: string, to: string) =>
      result.edges.some((edge) => edge.from === from && edge.to === to);

    expect(result.nodes[replayFamily]).toBeUndefined();
    expect(result.nodes[deadFamily]).toBeUndefined();
    expect(hasEdge(replay0, deadBlue)).toBe(true);
    expect(hasEdge(replay0, deadGreen)).toBe(false);
    expect(hasEdge(replay1, deadBlue)).toBe(false);
    expect(hasEdge(replay1, deadGreen)).toBe(true);
  });

  it('should fan cardinality members out to singleton targets', () => {
    const fanoutFamily = tgNodeIdFrom('resource', 'aws_lambda_function.fanout');
    const fanout0 = tgNodeIdFrom('resource', 'aws_lambda_function.fanout[0]');
    const fanout1 = tgNodeIdFrom('resource', 'aws_lambda_function.fanout[1]');
    const queue = tgNodeIdFrom('resource', 'aws_sqs_queue.broadcast');

    const graph: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [fanoutFamily]: {
          id: fanoutFamily,
          terraform: {
            kind: 'resource',
            address: 'aws_lambda_function.fanout',
            resource: 'aws_lambda_function',
            name: 'fanout',
          },
        },
        [fanout0]: {
          id: fanout0,
          terraform: {
            kind: 'resource',
            address: 'aws_lambda_function.fanout[0]',
            resource: 'aws_lambda_function',
            name: 'fanout[0]',
          },
        },
        [fanout1]: {
          id: fanout1,
          terraform: {
            kind: 'resource',
            address: 'aws_lambda_function.fanout[1]',
            resource: 'aws_lambda_function',
            name: 'fanout[1]',
          },
        },
        [queue]: {
          id: queue,
          terraform: {
            kind: 'resource',
            address: 'aws_sqs_queue.broadcast',
            resource: 'aws_sqs_queue',
            name: 'broadcast',
          },
        },
      },
      edges: [
        {
          id: edgeIdFrom(fanout0, fanoutFamily, 'member'),
          from: fanout0,
          to: fanoutFamily,
          attributes: {},
        },
        {
          id: edgeIdFrom(fanout1, fanoutFamily, 'member'),
          from: fanout1,
          to: fanoutFamily,
          attributes: {},
        },
        {
          id: edgeIdFrom(fanoutFamily, queue, 'queue'),
          from: fanoutFamily,
          to: queue,
          attributes: { relation: 'consumes' },
        },
      ],
    };

    const result = resolve(graph);
    expect(result.nodes[fanoutFamily]).toBeUndefined();
    expect(result.edges.some((edge) => edge.from === fanout0 && edge.to === queue)).toBe(true);
    expect(result.edges.some((edge) => edge.from === fanout1 && edge.to === queue)).toBe(true);
  });

  it('should fail closed when cardinality sets cannot be matched safely', () => {
    const replayFamily = tgNodeIdFrom('resource', 'aws_sqs_queue.replay');
    const replay0 = tgNodeIdFrom('resource', 'aws_sqs_queue.replay[0]');
    const replay1 = tgNodeIdFrom('resource', 'aws_sqs_queue.replay[1]');
    const deadBlue = tgNodeIdFrom('resource', 'aws_sqs_queue.dead_letter["blue"]');

    const graph: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [replayFamily]: {
          id: replayFamily,
          terraform: {
            kind: 'resource',
            address: 'aws_sqs_queue.replay',
            resource: 'aws_sqs_queue',
            name: 'replay',
          },
        },
        [replay0]: {
          id: replay0,
          terraform: {
            kind: 'resource',
            address: 'aws_sqs_queue.replay[0]',
            resource: 'aws_sqs_queue',
            name: 'replay[0]',
          },
        },
        [replay1]: {
          id: replay1,
          terraform: {
            kind: 'resource',
            address: 'aws_sqs_queue.replay[1]',
            resource: 'aws_sqs_queue',
            name: 'replay[1]',
          },
        },
        [deadBlue]: {
          id: deadBlue,
          terraform: {
            kind: 'resource',
            address: 'aws_sqs_queue.dead_letter["blue"]',
            resource: 'aws_sqs_queue',
            name: 'dead_letter["blue"]',
          },
        },
      },
      edges: [
        {
          id: edgeIdFrom(replay0, replayFamily, 'member'),
          from: replay0,
          to: replayFamily,
          attributes: {},
        },
        {
          id: edgeIdFrom(replay1, replayFamily, 'member'),
          from: replay1,
          to: replayFamily,
          attributes: {},
        },
        {
          id: edgeIdFrom(replayFamily, deadBlue, 'blue'),
          from: replayFamily,
          to: deadBlue,
          attributes: { relation: 'routes' },
        },
      ],
    };

    const result = resolve(graph);
    expect(result.nodes[replayFamily]).toBeDefined();
    expect(result.edges.some((edge) => edge.from === replay0 && edge.to === deadBlue)).toBe(false);
  });
});
