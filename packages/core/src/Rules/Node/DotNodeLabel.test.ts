import {
  DotAdapter,
  GraphologyAdapter,
  TG_SCHEMA_VERSION,
  type TgGraph,
  type TgNodeAttributes,
  asNodeId,
} from '@terra-graph/core';
import { DirectedGraph } from 'graphology';
import { DotNodeLabel } from './DotNodeLabel.js';
import '../registerAll.js';

const makeExpectedLabel = (resourceType: string, resourceName: string): string => `
      <<table align="left" border="0" cellpadding="0" cellspacing="0" cellborder="0">
        <tr>
          <td align="left">${resourceName}</td>
        </tr>
        <tr>
          <td align="left"><font point-size="10" color="#999999">${resourceType}</font></td>
        </tr>
      </table>>`;

const makeExpectedImageLabel = (
  resourceType: string,
  resourceName: string,
  image: string,
): string => `
      <<table align="left" border="0" cellpadding="0" cellspacing="0" cellborder="0">
        <tr>
          <td align="center">
            <table border="0" cellpadding="0" cellspacing="0" cellborder="0">
              <tr>
                <td width="86" height="86" fixedsize="true"><IMG SCALE="TRUE" SRC="${image}"/></td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="left">
            <table align="left" border="0" cellpadding="0" cellspacing="0" cellborder="0">
              <tr>
                <td align="left">${resourceName}</td>
              </tr>
              <tr>
                <td align="left"><font point-size="10" color="#999999">${resourceType}</font></td>
              </tr>
            </table>
          </td>
        </tr>
      </table>>`;

describe('DotNodeLabel.supports', () => {
  it('should only support DotAdapter instances', () => {
    const rule = new DotNodeLabel({
      node: { nodeId: { eq: 'node-a' } },
    });

    const dotAdapter = new DotAdapter(new DirectedGraph());
    const graphAdapter = new GraphologyAdapter(new DirectedGraph());

    expect(rule.supports(dotAdapter)).toBe(true);
    expect(rule.supports(graphAdapter)).toBe(false);
  });
});

describe('DotNodeLabel.apply', () => {
  it('should keep graph unchanged when apply is called without a match', () => {
    const nodeId = asNodeId('node-a');
    const tg: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [nodeId]: { id: nodeId, label: 'node-a' },
      },
      edges: [],
    };

    const adapter = new DotAdapter(new DirectedGraph()).withTgGraph(tg);
    const node = adapter.getNodeAttributes(nodeId);
    if (!node) {
      throw new Error('Missing node attributes for node');
    }

    const rule = new DotNodeLabel({
      node: { nodeId: { eq: 'different-node' } },
    });

    const result = rule.apply(nodeId, node, adapter);

    expect(result.getNodeAttributes(nodeId)).toEqual(node);
  });

  it('should set dot adapter label when matched and preserve other adapter data', () => {
    const nodeId = asNodeId('node-a');
    const tg: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [nodeId]: {
          id: nodeId,
          label: 'node-a',
          terraform: {
            resource: 'aws_instance',
            name: 'web',
          },
          adapter: {
            OtherAdapter: { style: 'bold' },
            [DotAdapter.name]: { color: 'red', label: 'old' },
          },
        },
      },
      edges: [],
    };

    const adapter = new DotAdapter(new DirectedGraph()).withTgGraph(tg);
    const node = adapter.getNodeAttributes(nodeId);
    if (!node) {
      throw new Error('Missing node attributes for node');
    }

    const rule = new DotNodeLabel({
      node: { nodeId: { eq: nodeId.toString() } },
    });

    rule.match(nodeId, node, adapter);
    const result = rule.apply(nodeId, node, adapter);

    expect(result.getNodeAttributes(nodeId)).toEqual({
      ...node,
      adapter: {
        OtherAdapter: { style: 'bold' },
        [DotAdapter.name]: {
          color: 'red',
          label: makeExpectedLabel('aws_instance', 'web'),
          shape: 'plaintext',
        },
      },
    });
  });

  it('should fall back to the node label when no resource/name pair exists', () => {
    const nodeId = asNodeId('node-b');
    const tg: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [nodeId]: { id: nodeId, label: 'node-b' },
      },
      edges: [],
    };

    const adapter = new DotAdapter(new DirectedGraph()).withTgGraph(tg);
    const node = adapter.getNodeAttributes(nodeId);
    if (!node) {
      throw new Error('Missing node attributes for node');
    }

    const rule = new DotNodeLabel({
      node: { nodeId: { eq: nodeId.toString() } },
    });

    rule.match(nodeId, node, adapter);
    const result = rule.apply(nodeId, node, adapter);

    expect(result.getNodeAttributes(nodeId)).toEqual({
      ...node,
      adapter: {
        [DotAdapter.name]: {
          label: 'node-b',
          shape: 'plaintext',
        },
      },
    } as TgNodeAttributes);
  });

  it('should render images inside a fixed-size html cell and keep text in its own row', () => {
    const nodeId = asNodeId('node-c');
    const image = '/tmp/private-subnet.png';
    const tg: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [nodeId]: {
          id: nodeId,
          terraform: {
            resource: 'aws_subnet',
            name: 'private_a',
          },
          hints: {
            layout: {
              image,
            },
          },
        },
      },
      edges: [],
    };

    const adapter = new DotAdapter(new DirectedGraph()).withTgGraph(tg);
    const node = adapter.getNodeAttributes(nodeId);
    if (!node) {
      throw new Error('Missing node attributes for node');
    }

    const rule = new DotNodeLabel({
      node: { nodeId: { eq: nodeId.toString() } },
    });

    rule.match(nodeId, node, adapter);
    const result = rule.apply(nodeId, node, adapter);

    expect(result.getNodeAttributes(nodeId)).toEqual({
      ...node,
      adapter: {
        [DotAdapter.name]: {
          label: makeExpectedImageLabel('aws_subnet', 'private_a', image),
          shape: 'plaintext',
        },
      },
    } as TgNodeAttributes);
  });
});
