import {
  type AdapterOperations,
  DotAdapter,
  type NodeId,
  NodeRule,
  TgNode,
  type TgNodeAttributes,
} from '@terra-graph/core';
import { TgNodeLabel } from '@terra-graph/core/Graph/Renderers/TgNodeLabel.js';

export class DotNodeLabel extends NodeRule {
  public override supports(adapter: AdapterOperations): boolean {
    return adapter instanceof DotAdapter;
  }

  public override apply(
    nodeId: NodeId,
    node: TgNodeAttributes,
    graph: AdapterOperations,
  ): AdapterOperations {
    if (!this.wasMatched(nodeId)) {
      return graph;
    }

    const adapterKey = DotAdapter.name;

    return graph.setNodeAttributes(nodeId, {
      ...node,
      adapter: {
        ...(node.adapter ?? {}),
        [adapterKey]: {
          ...(node.adapter?.[adapterKey] ?? {}),
          label: this.makeHtmlLabel(new TgNodeLabel({ id: nodeId, ...node })),
        },
      },
    });
  }

  private makeHtmlLabel(node: TgNodeLabel): string {
    const [resourceType, resourceName] = node.getLabel().split('.');
    if (!(resourceType && resourceName)) {
      return node.getLabel();
    }

    return `
      <<table align="left" border="0" cellpadding="0" cellspacing="0" cellborder="0">
        <tr>
          <td align="left">${resourceName}</td>
        </tr>
        <tr>
          <td align="left"><font point-size="10" color="#999999">${resourceType}</font></td>
        </tr>
      </table>>`;
  }
}

NodeRule.register(DotNodeLabel);
