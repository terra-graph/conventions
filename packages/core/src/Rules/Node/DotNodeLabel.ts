import {
  type AdapterOperations,
  DotAdapter,
  type NodeId,
  NodeRule,
  type TgNodeAttributes,
  TgNodeLabel,
} from '@terra-graph/core';

export class DotNodeLabel extends NodeRule {
  private static readonly imageCellSizePoints = Math.round(1.2 * 72);

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
          label: this.makeHtmlLabel(node, nodeId),
          shape: 'plaintext',
        },
      },
    });
  }

  private makeHtmlLabel(node: TgNodeAttributes, nodeId: NodeId): string {
    const tgNodeLabel = new TgNodeLabel({ id: nodeId, ...node });
    const label = tgNodeLabel.getLabel();
    if (node.projection && node.hints?.layout?.text2) {
      return this.makeStructuredLabel(label, node.hints.layout.text2, node.hints.layout.image);
    }

    const [resourceType, resourceName] = label.split('.');
    if (!(resourceType && resourceName)) {
      return label;
    }

    return this.makeStructuredLabel(
      node.hints?.layout?.text1 ?? resourceName,
      node.hints?.layout?.text2 ?? resourceType,
      node.hints?.layout?.image,
    );
  }

  private makeStructuredLabel(primaryText: string, secondaryText: string, image?: string): string {
    if (!image) {
      return `
      <<table align="left" border="0" cellpadding="0" cellspacing="0" cellborder="0">
        <tr>
          <td align="left">${primaryText}</td>
        </tr>
        <tr>
          <td align="left"><font point-size="10" color="#999999">${secondaryText}</font></td>
        </tr>
      </table>>`;
    }

    return `
      <<table align="left" border="0" cellpadding="0" cellspacing="0" cellborder="0">
        <tr>
          <td align="center">
            <table border="0" cellpadding="0" cellspacing="0" cellborder="0">
              <tr>
                <td width="${DotNodeLabel.imageCellSizePoints}" height="${DotNodeLabel.imageCellSizePoints}" fixedsize="true"><IMG SCALE="TRUE" SRC="${image}"/></td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="left">
            <table align="left" border="0" cellpadding="0" cellspacing="0" cellborder="0">
              <tr>
                <td align="left">${primaryText}</td>
              </tr>
              <tr>
                <td align="left"><font point-size="10" color="#999999">${secondaryText}</font></td>
              </tr>
            </table>
          </td>
        </tr>
      </table>>`;
  }
}

NodeRule.register(DotNodeLabel);
