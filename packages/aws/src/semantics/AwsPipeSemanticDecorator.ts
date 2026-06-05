import {
  addSemanticFactBetweenNodes,
  buildProjectionOwners,
  resolveTerraformStringFieldOrReference,
  type NodeId,
  projectSemanticFactsByOwners,
  resolveNodeArn,
  resolveNodeReference,
  type SemanticDecorator,
  type TgNodeAttributes,
  type TgSemanticFact,
  normalizeTerraformAddress,
} from '@terra-graph/core';
import { semanticDecoratorId } from '../namespaces.js';

const resolvePipeEndpointArn = (
  node: TgNodeAttributes,
  key: 'source' | 'target',
): string | undefined => {
  return resolveTerraformStringFieldOrReference(node, key);
};


const pipeFact = (
  decorator: string,
  kind: string,
  from: NodeId,
  to: NodeId,
  endpoint: 'source' | 'target',
): TgSemanticFact => ({
  kind,
  from,
  to,
  source: 'explicit_connection',
  confidence: 'exact',
  decorator,
  attributes: {
    connector: 'aws_pipes_pipe',
    endpoint,
  },
});

export class AwsPipeSemanticDecorator implements SemanticDecorator {
  public static readonly id = semanticDecoratorId(
    AwsPipeSemanticDecorator.name,
  );

  public readonly name = AwsPipeSemanticDecorator.id;

  public extract({
    graph,
  }: Parameters<SemanticDecorator['extract']>[0]): ReturnType<
    SemanticDecorator['extract']
  > {
    const arnToNodeId = new Map<string, NodeId>();
    const addressToNodeId = new Map<string, NodeId>();
    for (const nodeId of graph.nodeIds()) {
      const node = graph.getNodeAttributes(nodeId);
      if (!node) {
        continue;
      }

      const arn = resolveNodeArn(node);
      if (arn) {
        arnToNodeId.set(arn, nodeId);
      }

      const address = node.terraform?.address;
      if (address) {
        addressToNodeId.set(address, nodeId);
        addressToNodeId.set(normalizeTerraformAddress(address), nodeId);
      }
    }

    let current = graph;
    for (const nodeId of graph.nodeIds()) {
      const node = graph.getNodeAttributes(nodeId);
      if (!node || node.terraform?.resource !== 'aws_pipes_pipe') {
        continue;
      }

      const sourceArn = resolvePipeEndpointArn(node, 'source');
      const targetArn = resolvePipeEndpointArn(node, 'target');
      const sourceNodeId = sourceArn
        ? arnToNodeId.get(sourceArn) ??
          resolveNodeReference(sourceArn, addressToNodeId)
        : undefined;
      const targetNodeId = targetArn
        ? arnToNodeId.get(targetArn) ??
          resolveNodeReference(targetArn, addressToNodeId)
        : undefined;

      if (sourceNodeId) {
        const fact = pipeFact(this.name, 'feeds', sourceNodeId, nodeId, 'source');
        current = addSemanticFactBetweenNodes(
          current,
          sourceNodeId,
          nodeId,
          fact,
          `semantic:${this.name}:${fact.kind}:source`,
        );
      }

      if (targetNodeId) {
        const fact = pipeFact(
          this.name,
          'delivers_to',
          nodeId,
          targetNodeId,
          'target',
        );
        current = addSemanticFactBetweenNodes(
          current,
          nodeId,
          targetNodeId,
          fact,
          `semantic:${this.name}:${fact.kind}:target`,
        );
      }
    }

    return current;
  }

  public project({
    graph,
  }: Parameters<SemanticDecorator['project']>[0]): ReturnType<
    SemanticDecorator['project']
  > {
    const projectionOwners = buildProjectionOwners(graph);
    return projectSemanticFactsByOwners(graph, this.name, projectionOwners);
  }
}
