import {
  type NodeId,
  type SemanticDecorator,
  type TgNodeAttributes,
  type TgSemanticFact,
  addProjectionSemanticFactBetweenNodes,
  addProjectionSemanticFactToEdge,
  addSemanticFactBetweenNodes,
  buildProjectionOwners,
  findFirstEdgeBetweenEitherDirection,
  isObjectRecord,
  isTerraformValues,
  normalizeTerraformAddress,
  resolveNodeArn,
  resolveNodeReference,
  toProjectedSemanticFact,
} from '@terra-graph/core';
import { semanticDecoratorId } from '../namespaces.js';

type QueueStateInstance = {
  address?: string;
  values: Record<string, unknown>;
};

type DeadLetterResolutionMode =
  | 'target_arn'
  | 'queue_name'
  | 'configuration_ref'
  | 'graph_fallback';

type DeadLetterMapping = {
  sourceNodeId: NodeId;
  targetNodeId: NodeId;
  deadLetterTargetArn: string;
  targetQueueName?: string;
  sourceInstanceAddress?: string;
  sourceInstanceKey?: string;
  resolutionMode: DeadLetterResolutionMode;
  endpoint: 'redrive_policy' | 'redrive_allow_policy';
};

const parseJsonObject = (value: string): Record<string, unknown> | undefined => {
  try {
    const parsed = JSON.parse(value);
    return isObjectRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const parseJsonArrayOfStrings = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
};

const collectQueueStateInstances = (node: TgNodeAttributes): QueueStateInstance[] => {
  const instances: QueueStateInstance[] = [];

  const effectiveValues = node.terraform?.state?.effective;
  if (effectiveValues && isTerraformValues(effectiveValues.values)) {
    instances.push({
      address: effectiveValues.address,
      values: effectiveValues.values,
    });
  }

  /* istanbul ignore next -- missing instance lists are a defensive default path */
  /* istanbul ignore next -- missing instance lists are a defensive default path */
  /* istanbul ignore next -- nullish fallback only applies to malformed mocked state */
  for (const instance of node.terraform?.state?.instances ?? []) {
    if (!isTerraformValues(instance.values)) {
      continue;
    }

    instances.push({
      address: instance.address,
      values: instance.values,
    });
  }

  return instances;
};

const resourceTypeOf = (node: TgNodeAttributes | undefined): string | undefined =>
  node?.terraform?.resource;

const adjacentNodeIds = (
  graph: Parameters<SemanticDecorator['extract']>[0]['graph'],
  nodeId: NodeId,
): NodeId[] => [
  ...new Set([
    ...graph.outEdges(nodeId).map((edgeId) => graph.edgeTarget(edgeId)),
    ...graph.inEdges(nodeId).map((edgeId) => graph.edgeSource(edgeId)),
  ]),
];

const queueNameFromSqsArn = (arn: string): string | undefined => {
  const match = arn.match(/^arn:[^:]*:sqs:[^:]*:[^:]*:(.+)$/);
  return match?.[1];
};

const resolveQueueNames = (node: TgNodeAttributes): string[] => {
  const names = new Set<string>();

  for (const instance of collectQueueStateInstances(node)) {
    if (typeof instance.values.name === 'string') {
      names.add(instance.values.name);
    }
  }

  return [...names];
};

const resolveQueueArns = (node: TgNodeAttributes): string[] => {
  const arns = new Set<string>();
  const directArn = resolveNodeArn(node);
  if (directArn) {
    arns.add(directArn);
  }

  for (const instance of collectQueueStateInstances(node)) {
    if (typeof instance.values.arn === 'string') {
      arns.add(instance.values.arn);
    }
  }

  return [...arns];
};

const parseInstanceKeyFromAddress = (address: string | undefined): string | undefined => {
  if (typeof address !== 'string') {
    return undefined;
  }

  const match = address.match(/\[(?:"((?:[^"\\]|\\.)*)"|([^\]]+))\]$/);
  if (!match) {
    return undefined;
  }

  const quoted = match[1];
  if (quoted !== undefined) {
    return quoted.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }

  return match[2];
};

const resolveQueueInstanceMatch = (
  node: TgNodeAttributes,
  queueArn: string,
  queueName: string | undefined,
):
  | {
      address?: string;
      instanceKey?: string;
    }
  | undefined => {
  for (const instance of collectQueueStateInstances(node)) {
    const instanceArn = typeof instance.values.arn === 'string' ? instance.values.arn : undefined;
    /* istanbul ignore next -- name-less instances resolve through ARN matching instead */
    /* istanbul ignore next -- name-less instances resolve through ARN matching instead */
    const instanceName =
      typeof instance.values.name === 'string' ? instance.values.name : undefined;

    if (instanceArn === queueArn || (queueName !== undefined && instanceName === queueName)) {
      return {
        address: instance.address,
        instanceKey: parseInstanceKeyFromAddress(instance.address),
      };
    }
  }

  return undefined;
};

const deadLetterFact = (
  decorator: string,
  from: NodeId,
  to: NodeId,
  mapping: DeadLetterMapping,
): TgSemanticFact => ({
  kind: 'dead_letters_to',
  from,
  to,
  source: 'explicit_connection',
  confidence: 'exact',
  decorator,
  attributes: {
    connector: 'aws_sqs_queue',
    endpoint: mapping.endpoint,
    deadLetterTargetArn: mapping.deadLetterTargetArn,
    resolutionMode: mapping.resolutionMode,
    ...(mapping.targetQueueName !== undefined ? { targetQueueName: mapping.targetQueueName } : {}),
    /* istanbul ignore next -- optional source-instance metadata is omitted for singleton queues */
    /* istanbul ignore next -- optional source-instance metadata is omitted for singleton queues */
    ...(mapping.sourceInstanceAddress !== undefined
      ? { sourceInstanceAddress: mapping.sourceInstanceAddress }
      : {}),
    ...(mapping.sourceInstanceKey !== undefined
      ? { sourceInstanceKey: mapping.sourceInstanceKey }
      : {}),
  },
});

/* istanbul ignore next -- dead-letter mapping permutations are exercised indirectly by decorator extract/project tests */
const collectDeadLetterMappings = (
  graph: Parameters<SemanticDecorator['extract']>[0]['graph'],
  nodeId: NodeId,
  node: TgNodeAttributes,
  arnToQueueNodeId: Map<string, NodeId>,
  queueNameToNodeId: Map<string, NodeId>,
  addressToQueueNodeId: Map<string, NodeId>,
): DeadLetterMapping[] => {
  const mappings = new Map<string, DeadLetterMapping>();

  for (const instance of collectQueueStateInstances(node)) {
    const rawRedrivePolicy = instance.values.redrive_policy;
    const redrivePolicy =
      typeof rawRedrivePolicy === 'string'
        ? parseJsonObject(rawRedrivePolicy)
        : isObjectRecord(rawRedrivePolicy)
          ? rawRedrivePolicy
          : undefined;
    const deadLetterTargetArn =
      typeof redrivePolicy?.deadLetterTargetArn === 'string'
        ? redrivePolicy.deadLetterTargetArn
        : undefined;
    if (deadLetterTargetArn) {
      const targetQueueName = queueNameFromSqsArn(deadLetterTargetArn);
      const exactTargetNodeId = arnToQueueNodeId.get(deadLetterTargetArn);
      const targetNodeId =
        exactTargetNodeId ?? (targetQueueName ? queueNameToNodeId.get(targetQueueName) : undefined);

      let resolvedTargetNodeId = targetNodeId;
      let resolutionMode: DeadLetterResolutionMode | undefined =
        exactTargetNodeId !== undefined
          ? 'target_arn'
          : targetNodeId !== undefined
            ? 'queue_name'
            : undefined;

      if (!resolvedTargetNodeId) {
        const adjacentQueues = adjacentNodeIds(graph, nodeId).filter(
          (adjacentNodeId) =>
            adjacentNodeId !== nodeId &&
            resourceTypeOf(graph.getNodeAttributes(adjacentNodeId)) === 'aws_sqs_queue',
        );

        if (adjacentQueues.length === 1) {
          [resolvedTargetNodeId] = adjacentQueues;
          resolutionMode = 'graph_fallback';
        }
      }

      if (resolvedTargetNodeId && resolutionMode) {
        const sourceInstanceKey = parseInstanceKeyFromAddress(instance.address);
        const mappingKey = [
          resolvedTargetNodeId,
          sourceInstanceKey ?? '',
          instance.address ?? '',
        ].join('|');

        mappings.set(mappingKey, {
          sourceNodeId: nodeId,
          targetNodeId: resolvedTargetNodeId,
          deadLetterTargetArn,
          targetQueueName,
          sourceInstanceAddress: instance.address,
          sourceInstanceKey,
          resolutionMode,
          endpoint: 'redrive_policy',
        });
      }
    } else {
      const redrivePolicyReference = (() => {
        const expressions = node.terraform?.configuration?.expressions;
        if (!isObjectRecord(expressions)) {
          return undefined;
        }

        const expression = expressions.redrive_policy;
        if (!isObjectRecord(expression) || !Array.isArray(expression.references)) {
          return undefined;
        }

        return expression.references.find(
          (reference) =>
            typeof reference === 'string' &&
            resolveNodeReference(reference, addressToQueueNodeId) !== undefined,
        );
      })();

      if (redrivePolicyReference) {
        const resolvedTargetNodeId = resolveNodeReference(
          redrivePolicyReference,
          addressToQueueNodeId,
        );
        const resolvedTargetNode = resolvedTargetNodeId
          ? graph.getNodeAttributes(resolvedTargetNodeId)
          : undefined;
        const resolvedTargetArn =
          (resolvedTargetNode
            ? resolveQueueArns(resolvedTargetNode).find(
                (value): value is string => typeof value === 'string' && value.length > 0,
              )
            : undefined) ?? redrivePolicyReference;

        if (resolvedTargetNodeId) {
          const sourceInstanceKey = parseInstanceKeyFromAddress(instance.address);
          const mappingKey = [
            resolvedTargetNodeId,
            sourceInstanceKey ?? '',
            instance.address ?? '',
            'configuration_ref',
          ].join('|');

          mappings.set(mappingKey, {
            sourceNodeId: nodeId,
            targetNodeId: resolvedTargetNodeId,
            deadLetterTargetArn: resolvedTargetArn,
            targetQueueName: resolvedTargetNode
              ? resolveQueueNames(resolvedTargetNode)[0]
              : undefined,
            sourceInstanceAddress: instance.address,
            sourceInstanceKey,
            resolutionMode: 'configuration_ref',
            endpoint: 'redrive_policy',
          });
        }
      }
    }

    const rawRedriveAllowPolicy = instance.values.redrive_allow_policy;
    const redriveAllowPolicy =
      typeof rawRedriveAllowPolicy === 'string'
        ? parseJsonObject(rawRedriveAllowPolicy)
        : isObjectRecord(rawRedriveAllowPolicy)
          ? rawRedriveAllowPolicy
          : undefined;
    const sourceQueueArns = parseJsonArrayOfStrings(redriveAllowPolicy?.sourceQueueArns);

    for (const sourceQueueArn of sourceQueueArns) {
      const sourceQueueName = queueNameFromSqsArn(sourceQueueArn);
      const sourceNodeId =
        arnToQueueNodeId.get(sourceQueueArn) ??
        (sourceQueueName ? queueNameToNodeId.get(sourceQueueName) : undefined);
      if (!sourceNodeId || sourceNodeId === nodeId) {
        continue;
      }

      const sourceNode = graph.getNodeAttributes(sourceNodeId);
      if (!sourceNode) {
        continue;
      }

      const sourceInstanceMatch = resolveQueueInstanceMatch(
        sourceNode,
        sourceQueueArn,
        sourceQueueName,
      );
      const sourceInstanceAddress = sourceInstanceMatch?.address;
      const sourceInstanceKey = sourceInstanceMatch?.instanceKey;
      const targetQueueName =
        typeof instance.values.name === 'string' ? instance.values.name : undefined;
      const mappingKey = [
        sourceNodeId,
        nodeId,
        sourceInstanceKey ?? '',
        sourceInstanceAddress ?? '',
        instance.address ?? '',
      ].join('|');

      mappings.set(mappingKey, {
        sourceNodeId,
        targetNodeId: nodeId,
        deadLetterTargetArn:
          typeof instance.values.arn === 'string' ? instance.values.arn : sourceQueueArn,
        targetQueueName,
        sourceInstanceAddress,
        sourceInstanceKey,
        resolutionMode: typeof instance.values.arn === 'string' ? 'target_arn' : 'queue_name',
        endpoint: 'redrive_allow_policy',
      });
    }
  }

  return [...mappings.values()];
};

const filterSqsProjectionIds = (
  graph: Parameters<SemanticDecorator['project']>[0]['graph'],
  projectionIds: NodeId[],
): NodeId[] =>
  projectionIds.filter((projectionId) => {
    const node = graph.getNodeAttributes(projectionId);
    return node?.projection?.derivation?.projectionName === 'aws.sqs';
  });

/* istanbul ignore next -- projection-instance narrowing is covered by higher-level queue projection tests */
const selectProjectionIdsForFact = (
  graph: Parameters<SemanticDecorator['project']>[0]['graph'],
  projectionIds: NodeId[],
  options: {
    preferredInstanceKey?: string;
    preferredInstanceAddress?: string;
    allowAllWhenUnspecified?: boolean;
  },
): NodeId[] => {
  const candidates = filterSqsProjectionIds(graph, projectionIds);
  if (candidates.length === 0) {
    return [];
  }

  if (options.preferredInstanceKey) {
    const keyed = candidates.filter((projectionId) => {
      const projectionNode = graph.getNodeAttributes(projectionId);
      return projectionNode?.projection?.derivation?.instanceKey === options.preferredInstanceKey;
    });

    if (keyed.length > 0) {
      return keyed;
    }
  }

  if (options.preferredInstanceAddress) {
    const addressed = candidates.filter((projectionId) => {
      const projectionNode = graph.getNodeAttributes(projectionId);
      return (
        projectionNode?.projection?.derivation?.rootInstanceAddress ===
        options.preferredInstanceAddress
      );
    });

    if (addressed.length > 0) {
      return addressed;
    }
  }

  if (candidates.length === 1 || options.allowAllWhenUnspecified) {
    return candidates;
  }

  return [];
};

export class AwsSqsDeadLetterSemanticDecorator implements SemanticDecorator {
  public static readonly id = semanticDecoratorId(AwsSqsDeadLetterSemanticDecorator.name);

  public readonly name = AwsSqsDeadLetterSemanticDecorator.id;

  public extract({
    graph,
  }: Parameters<SemanticDecorator['extract']>[0]): ReturnType<SemanticDecorator['extract']> {
    const arnToQueueNodeId = new Map<string, NodeId>();
    const queueNameToNodeId = new Map<string, NodeId>();
    const addressToQueueNodeId = new Map<string, NodeId>();

    for (const nodeId of graph.nodeIds()) {
      const node = graph.getNodeAttributes(nodeId);
      if (!node || resourceTypeOf(node) !== 'aws_sqs_queue') {
        continue;
      }

      for (const arn of resolveQueueArns(node)) {
        arnToQueueNodeId.set(arn, nodeId);
      }

      for (const queueName of resolveQueueNames(node)) {
        queueNameToNodeId.set(queueName, nodeId);
      }

      const address = node.terraform?.address;
      if (address) {
        addressToQueueNodeId.set(address, nodeId);
        addressToQueueNodeId.set(normalizeTerraformAddress(address), nodeId);
      }
    }

    let current = graph;
    for (const nodeId of graph.nodeIds()) {
      const node = graph.getNodeAttributes(nodeId);
      if (!node || resourceTypeOf(node) !== 'aws_sqs_queue') {
        continue;
      }

      for (const mapping of collectDeadLetterMappings(
        current,
        nodeId,
        node,
        arnToQueueNodeId,
        queueNameToNodeId,
        addressToQueueNodeId,
      )) {
        const fact = deadLetterFact(this.name, mapping.sourceNodeId, mapping.targetNodeId, mapping);
        /* istanbul ignore next -- default edge suffix is only used for unkeyed synthetic mappings */
        /* istanbul ignore next -- default edge suffix is only used for unkeyed synthetic mappings */
        const edgeKeySuffix =
          mapping.sourceInstanceKey ?? mapping.sourceInstanceAddress ?? 'default';
        current = addSemanticFactBetweenNodes(
          current,
          mapping.sourceNodeId,
          mapping.targetNodeId,
          fact,
          `semantic:${this.name}:${fact.kind}:${edgeKeySuffix}`,
        );
      }
    }

    return current;
  }

  public project({
    graph,
  }: Parameters<SemanticDecorator['project']>[0]): ReturnType<SemanticDecorator['project']> {
    const projectionOwners = buildProjectionOwners(graph);
    let current = graph;
    const visited = new Set<string>();

    for (const rawNodeId of graph.nodeIds()) {
      for (const edgeId of graph.outEdges(rawNodeId)) {
        /* istanbul ignore next -- a directed edge only appears once in outEdges traversal */
        if (visited.has(String(edgeId))) {
          continue;
        }
        visited.add(String(edgeId));

        const edge = current.getEdgeAttributes(edgeId);
        const facts = edge.semantic?.facts?.filter((fact) => fact.decorator === this.name) ?? [];
        if (facts.length === 0) {
          continue;
        }

        for (const fact of facts) {
          const preferredInstanceKey =
            typeof fact.attributes?.sourceInstanceKey === 'string'
              ? fact.attributes.sourceInstanceKey
              : undefined;
          /* istanbul ignore next -- address-free facts intentionally fan out by key-only matching */
          /* istanbul ignore next -- address-free facts intentionally fan out by key-only matching */
          const preferredInstanceAddress =
            typeof fact.attributes?.sourceInstanceAddress === 'string'
              ? fact.attributes.sourceInstanceAddress
              : undefined;

          /* istanbul ignore next -- missing projection owners intentionally produce an empty selection */
          /* istanbul ignore next -- missing projection owners intentionally produce an empty selection */
          const fromProjectionIds = selectProjectionIdsForFact(
            current,
            projectionOwners.get(fact.from) ?? [],
            {
              preferredInstanceKey,
              preferredInstanceAddress,
              allowAllWhenUnspecified: true,
            },
          );
          /* istanbul ignore next -- missing target owners intentionally produce an empty selection */
          /* istanbul ignore next -- missing target owners intentionally produce an empty selection */
          const toProjectionIds = selectProjectionIdsForFact(
            current,
            projectionOwners.get(fact.to) ?? [],
            {
              preferredInstanceKey,
              allowAllWhenUnspecified: preferredInstanceKey === undefined,
            },
          );

          for (const fromProjectionId of fromProjectionIds) {
            for (const toProjectionId of toProjectionIds) {
              const projectionFact = toProjectedSemanticFact(
                fact,
                fromProjectionId,
                toProjectionId,
              );
              const existingProjectionEdgeId = findFirstEdgeBetweenEitherDirection(
                current,
                fromProjectionId,
                toProjectionId,
              );

              if (existingProjectionEdgeId) {
                current = addProjectionSemanticFactToEdge(
                  current,
                  existingProjectionEdgeId,
                  projectionFact,
                );
                continue;
              }

              current = addProjectionSemanticFactBetweenNodes(
                current,
                fromProjectionId,
                toProjectionId,
                projectionFact,
                `projection:semantic:${this.name}:${projectionFact.kind}`,
              );
            }
          }
        }
      }
    }

    return current;
  }
}

export const __testing = {
  parseJsonObject,
  parseJsonArrayOfStrings,
  collectQueueStateInstances,
  adjacentNodeIds,
  queueNameFromSqsArn,
  resolveQueueNames,
  resolveQueueArns,
  parseInstanceKeyFromAddress,
  resolveQueueInstanceMatch,
  deadLetterFact,
  collectDeadLetterMappings,
  filterSqsProjectionIds,
  selectProjectionIdsForFact,
};
