import {
  edgeIdFrom,
  type NodeId,
  addProjectionSemanticFactToEdge,
  addSemanticFactToEdge,
  findFirstEdgeBetweenEitherDirection,
  type SemanticDecorator,
  type TgNodeAttributes,
  type TgSemanticFact,
} from '@terra-graph/core';
import { semanticDecoratorId } from '../namespaces.js';

type TerraformValues = Record<string, unknown>;

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isTerraformValues = (value: unknown): value is TerraformValues =>
  isObjectRecord(value);

const resolveNodeArn = (node: TgNodeAttributes): string | undefined => {
  const values = node.terraform?.state?.effective?.values;
  if (!isTerraformValues(values)) {
    return undefined;
  }

  return typeof values.arn === 'string' ? values.arn : undefined;
};

const isArrayOfUnknown = (value: unknown): value is unknown[] =>
  Array.isArray(value);

const findStringReference = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  if (isArrayOfUnknown(value)) {
    for (const entry of value) {
      const resolved = findStringReference(entry);
      if (resolved) {
        return resolved;
      }
    }
    return undefined;
  }

  if (!isObjectRecord(value)) {
    return undefined;
  }

  if ('references' in value && isArrayOfUnknown(value.references)) {
    for (const reference of value.references) {
      if (typeof reference === 'string' && reference.length > 0) {
        return reference;
      }
    }
  }

  for (const entry of Object.values(value)) {
    const resolved = findStringReference(entry);
    if (resolved) {
      return resolved;
    }
  }

  return undefined;
};

const resolvePipeEndpointArn = (
  node: TgNodeAttributes,
  key: 'source' | 'target',
): string | undefined => {
  const values = node.terraform?.state?.effective?.values;
  if (isTerraformValues(values) && typeof values[key] === 'string') {
    return values[key];
  }

  const expressions = node.terraform?.configuration?.expressions;
  if (!isObjectRecord(expressions)) {
    return undefined;
  }

  return findStringReference(expressions[key]);
};

const normalizeTerraformAddress = (address: string): string =>
  address.replace(/\[[^\]]+\]/g, '');

const resolveNodeReference = (
  reference: string,
  nodesByAddress: Map<string, NodeId>,
): NodeId | undefined => {
  let candidate = reference;
  while (candidate.length > 0) {
    const normalizedCandidate = normalizeTerraformAddress(candidate);
    const resolved =
      nodesByAddress.get(candidate) ?? nodesByAddress.get(normalizedCandidate);
    if (resolved) {
      return resolved;
    }

    const nextIndex = candidate.lastIndexOf('.');
    if (nextIndex < 0) {
      break;
    }
    candidate = candidate.slice(0, nextIndex);
  }

  return undefined;
};

const buildProjectionOwners = (
  graph: Parameters<SemanticDecorator['project']>[0]['graph'],
): Map<NodeId, NodeId[]> => {
  const owners = new Map<NodeId, NodeId[]>();

  for (const nodeId of graph.nodeIds()) {
    const node = graph.getNodeAttributes(nodeId);
    const derivation = node?.projection?.derivation;
    if (!derivation) {
      continue;
    }

    const ownerIds = new Set<NodeId>();
    if (derivation.rootNodeId) {
      ownerIds.add(derivation.rootNodeId);
    }
    for (const anchor of derivation.anchors ?? []) {
      ownerIds.add(anchor.nodeId);
    }

    for (const ownerId of ownerIds) {
      const current = owners.get(ownerId) ?? [];
      owners.set(ownerId, [...current, nodeId]);
    }
  }

  return owners;
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

const toProjectedFact = (
  fact: TgSemanticFact,
  fromProjectionId: NodeId,
  toProjectionId: NodeId,
): TgSemanticFact => ({
  ...fact,
  from: fromProjectionId,
  to: toProjectionId,
  attributes: {
    ...(fact.attributes ?? {}),
    rawFrom: fact.from,
    rawTo: fact.to,
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
        const existingEdgeId = findFirstEdgeBetweenEitherDirection(
          current,
          nodeId,
          sourceNodeId,
        );
        const edgeId =
          existingEdgeId ??
          edgeIdFrom(
            sourceNodeId,
            nodeId,
            `semantic:${this.name}:${fact.kind}:source`,
          );
        if (existingEdgeId) {
          current = addSemanticFactToEdge(current, edgeId, fact);
        } else {
          current = current.setEdge(edgeId, sourceNodeId, nodeId, {
            semantic: {
              facts: [fact],
            },
          });
        }
      }

      if (targetNodeId) {
        const fact = pipeFact(
          this.name,
          'delivers_to',
          nodeId,
          targetNodeId,
          'target',
        );
        const existingEdgeId = findFirstEdgeBetweenEitherDirection(
          current,
          nodeId,
          targetNodeId,
        );
        const edgeId =
          existingEdgeId ??
          edgeIdFrom(
            nodeId,
            targetNodeId,
            `semantic:${this.name}:${fact.kind}:target`,
          );
        if (existingEdgeId) {
          current = addSemanticFactToEdge(current, edgeId, fact);
        } else {
          current = current.setEdge(edgeId, nodeId, targetNodeId, {
            semantic: {
              facts: [fact],
            },
          });
        }
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
    let current = graph;

    const visited = new Set<string>();
    for (const nodeId of graph.nodeIds()) {
      for (const edgeId of graph.outEdges(nodeId)) {
        if (visited.has(String(edgeId))) {
          continue;
        }
        visited.add(String(edgeId));

        const edge = current.getEdgeAttributes(edgeId);
        const facts =
          edge.semantic?.facts?.filter((fact) => fact.decorator === this.name) ??
          [];
        if (facts.length === 0) {
          continue;
        }

        for (const fact of facts) {
          const fromProjectionIds = projectionOwners.get(fact.from) ?? [];
          const toProjectionIds = projectionOwners.get(fact.to) ?? [];

          for (const fromProjectionId of fromProjectionIds) {
            for (const toProjectionId of toProjectionIds) {
              const projectionFact = toProjectedFact(
                fact,
                fromProjectionId,
                toProjectionId,
              );
              const projectionEdgeIds = [
                ...current.edgesBetween(fromProjectionId, toProjectionId),
                ...current.edgesBetween(toProjectionId, fromProjectionId),
              ];

              if (projectionEdgeIds.length === 0) {
                current = current.setEdge(
                  edgeIdFrom(
                    fromProjectionId,
                    toProjectionId,
                    `projection:semantic:${this.name}:${projectionFact.kind}`,
                  ),
                  fromProjectionId,
                  toProjectionId,
                  {
                    projection: {
                      layer: 'core',
                      semantics: {
                        facts: [projectionFact],
                      },
                    },
                  },
                );
                continue;
              }

              for (const projectionEdgeId of projectionEdgeIds) {
                current = addProjectionSemanticFactToEdge(
                  current,
                  projectionEdgeId,
                  projectionFact,
                );
              }
            }
          }
        }
      }
    }

    return current;
  }
}
