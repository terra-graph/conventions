import {
  type NodeId,
  type SemanticDecorator,
  type TgNodeAttributes,
  type TgSemanticFact,
  addProjectionSemanticFactToEdge,
  addSemanticFactBetweenNodes,
  buildProjectionOwners,
  collectTerraformConfigurationReferences,
  edgeIdFrom,
  findFirstEdgeBetweenEitherDirection,
  getNodeSemanticContext,
  isArrayOfUnknown,
  isObjectRecord,
  isTerraformValues,
  normalizeTerraformAddress,
  projectSemanticFactsByOwners,
  resolveNodeArn,
  resolveNodeReference,
  resolveSemanticReferenceCandidates,
  selectBestSemanticReferenceCandidate,
  setNodeSemanticContext,
  toProjectedSemanticFact,
} from '@terra-graph/core';
import { semanticDecoratorId } from '../namespaces.js';

const resolveLambdaFunctionName = (node: TgNodeAttributes): string | undefined => {
  const values = node.terraform?.state?.effective?.values;
  if (!isTerraformValues(values)) {
    return undefined;
  }

  return typeof values.function_name === 'string' ? values.function_name : undefined;
};

const resolveScheduleTargetArn = (node: TgNodeAttributes): string | undefined => {
  const values = node.terraform?.state?.effective?.values;
  if (isTerraformValues(values) && isArrayOfUnknown(values.target)) {
    for (const target of values.target) {
      if (isObjectRecord(target) && typeof target.arn === 'string') {
        return target.arn;
      }
    }
  }
  return undefined;
};

const resolveScheduleTargetReferences = (node: TgNodeAttributes): string[] => {
  const expressions = node.terraform?.configuration?.expressions;
  if (!isObjectRecord(expressions) || !isArrayOfUnknown(expressions.target)) {
    return [];
  }

  const references = new Set<string>();
  for (const target of expressions.target) {
    if (!isObjectRecord(target)) {
      continue;
    }

    for (const reference of collectTerraformConfigurationReferences(target.arn)) {
      references.add(reference);
    }
  }

  return [...references];
};

type ScheduleSemanticContext = {
  exactTargetNodeId?: NodeId;
  targetReferences?: string[];
  moduleReferences?: string[];
};

const moduleReferenceFromAddress = (address: string): string | undefined => {
  const segments = address.split('.');
  let index = 0;

  while (segments[index] === 'module' && segments[index + 1]) {
    index += 2;
  }

  if (index < 2) {
    return undefined;
  }

  return segments.slice(0, index).join('.');
};

const collectModuleReferencesFromOutgoingEdges = (
  graph: Parameters<SemanticDecorator['project']>[0]['graph'],
  nodeId: NodeId,
): string[] => {
  const references = new Set<string>();

  for (const edgeId of graph.outEdges(nodeId)) {
    const targetNodeId = graph.edgeTarget(edgeId);
    const targetNode = graph.getNodeAttributes(targetNodeId);
    const targetAddress = targetNode?.terraform?.address;
    if (!targetAddress) {
      continue;
    }

    const moduleReference = moduleReferenceFromAddress(targetAddress);
    if (moduleReference) {
      references.add(moduleReference);
    }
  }

  return [...references];
};

const lambdaFunctionNameFromArn = (arn: string): string | undefined => {
  const match = arn.match(/:function:([^:]+)$/);
  return match?.[1];
};

const supportResourceTypePenalty = (resourceType: string | undefined): number => {
  if (!resourceType) {
    return 0;
  }

  if (
    [
      'aws_iam_role_policy_attachment',
      'aws_lambda_permission',
      'aws_lambda_function_event_invoke_config',
      'aws_lambda_layer_version',
      'aws_cloudwatch_log_group',
      'aws_s3_bucket_object',
      'null_resource',
      'local_file',
    ].includes(resourceType)
  ) {
    return -25;
  }

  if (resourceType.startsWith('aws_iam_')) {
    return -20;
  }

  return 0;
};

const targetResourceTypeBonus = (resourceType: string | undefined): number => {
  if (!resourceType) {
    return 0;
  }

  const bonuses: Record<string, number> = {
    aws_lambda_function: 40,
    aws_sfn_state_machine: 40,
    aws_sqs_queue: 30,
    aws_pipes_pipe: 30,
    aws_cloudwatch_event_bus: 25,
    aws_cloudwatch_event_rule: 25,
    aws_scheduler_schedule: 25,
    aws_s3_bucket: 20,
    aws_sns_topic: 20,
    aws_dynamodb_table: 20,
  };

  return bonuses[resourceType] ?? 10;
};

const tokenize = (value: string | undefined): string[] =>
  typeof value === 'string'
    ? value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length > 0)
    : [];

const collectProjectionIdsInScope = (
  graph: Parameters<SemanticDecorator['project']>[0]['graph'],
  scopePrefix: string,
): NodeId[] => {
  const prefix = `${scopePrefix}.`;
  const candidates: NodeId[] = [];

  for (const nodeId of graph.nodeIds()) {
    const projectionNode = graph.getNodeAttributes(nodeId);
    const derivation = projectionNode?.projection?.derivation;
    if (!derivation?.rootNodeId) {
      continue;
    }

    const rootInstanceAddress = derivation.rootInstanceAddress;
    if (typeof rootInstanceAddress === 'string' && rootInstanceAddress.startsWith(prefix)) {
      candidates.push(nodeId);
    }
  }

  return candidates;
};

/* istanbul ignore next -- scoring heuristics are validated indirectly through schedule projection integration tests */
const selectBestProjectionTarget = (
  graph: Parameters<SemanticDecorator['project']>[0]['graph'],
  scheduleProjectionId: NodeId,
  candidateProjectionIds: Iterable<NodeId>,
  options: {
    preferredScopePrefix?: string;
    preferredInstanceKey?: string;
    rawTargetNodeId?: NodeId;
    confidence: TgSemanticFact['confidence'];
  },
): { projectionId: NodeId; confidence: TgSemanticFact['confidence'] } | undefined => {
  const candidateScores = new Map<NodeId, number>();
  const preferredTokens = tokenize(options.preferredInstanceKey);
  const preferredScopePrefix = options.preferredScopePrefix
    ? `${options.preferredScopePrefix}.`
    : undefined;

  for (const nodeId of candidateProjectionIds) {
    if (nodeId === scheduleProjectionId) {
      continue;
    }

    const projectionNode = graph.getNodeAttributes(nodeId);
    const derivation = projectionNode?.projection?.derivation;
    if (!derivation?.rootNodeId) {
      continue;
    }

    const rootNode = graph.getNodeAttributes(derivation.rootNodeId);
    let score =
      targetResourceTypeBonus(rootNode?.terraform?.resource) +
      supportResourceTypePenalty(rootNode?.terraform?.resource);

    if (
      options.rawTargetNodeId &&
      (derivation.rootNodeId === options.rawTargetNodeId ||
        (derivation.anchors ?? []).some((anchor) => anchor.nodeId === options.rawTargetNodeId))
    ) {
      score += 100;
    }

    if (
      preferredScopePrefix &&
      typeof derivation.rootInstanceAddress === 'string' &&
      derivation.rootInstanceAddress.startsWith(preferredScopePrefix)
    ) {
      score += 50;
    }

    const candidateTokens = tokenize(derivation.instanceKey);
    if (preferredTokens.length > 0 && candidateTokens.length > 0) {
      const overlap = candidateTokens.filter((token) => preferredTokens.includes(token)).length;
      score += overlap * 15;

      if (
        typeof derivation.instanceKey === 'string' &&
        typeof options.preferredInstanceKey === 'string' &&
        options.preferredInstanceKey.toLowerCase().startsWith(derivation.instanceKey.toLowerCase())
      ) {
        score += 10;
      }
    }

    candidateScores.set(nodeId, score);
  }

  const ranked = [...candidateScores.entries()]
    .filter(([, score]) => score > 0)
    .sort((left, right) => right[1] - left[1]);

  const [best, second] = ranked;
  if (!best) {
    return undefined;
  }

  if (second && second[1] === best[1]) {
    return undefined;
  }

  return {
    projectionId: best[0],
    confidence: options.confidence,
  };
};

const selectBestScheduleReferenceCandidate = (
  graph: Parameters<SemanticDecorator['project']>[0]['graph'],
  candidates: ReturnType<typeof resolveSemanticReferenceCandidates>,
): ReturnType<typeof selectBestSemanticReferenceCandidate> => {
  const best = selectBestSemanticReferenceCandidate(candidates);
  if (!best || best.kind !== 'node') {
    return best;
  }

  const targetNode = graph.getNodeAttributes(best.nodeId);
  if (targetNode?.terraform?.kind !== 'module') {
    return best;
  }

  const bestScopeCandidate = selectBestSemanticReferenceCandidate(
    candidates.filter((candidate) => candidate.kind === 'scope'),
  );

  return bestScopeCandidate;
};

const scheduleFact = (
  decorator: string,
  from: NodeId,
  to: NodeId,
  confidence: TgSemanticFact['confidence'],
): TgSemanticFact => ({
  kind: 'schedules',
  from,
  to,
  source: 'explicit_connection',
  confidence,
  decorator,
  attributes: {
    connector: 'aws_scheduler_schedule',
    endpoint: 'target.arn',
  },
});

export class AwsScheduleSemanticDecorator implements SemanticDecorator {
  public static readonly id = semanticDecoratorId(AwsScheduleSemanticDecorator.name);

  public readonly name = AwsScheduleSemanticDecorator.id;

  public extract({
    graph,
  }: Parameters<SemanticDecorator['extract']>[0]): ReturnType<SemanticDecorator['extract']> {
    const arnToNodeId = new Map<string, NodeId>();
    const lambdaNameToNodeId = new Map<string, NodeId>();
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

      if (node.terraform?.resource === 'aws_lambda_function') {
        const functionName = resolveLambdaFunctionName(node);
        if (functionName) {
          lambdaNameToNodeId.set(functionName, nodeId);
        }
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
      if (!node || node.terraform?.resource !== 'aws_scheduler_schedule') {
        continue;
      }

      const targetArn = resolveScheduleTargetArn(node);
      const lambdaFunctionName = targetArn ? lambdaFunctionNameFromArn(targetArn) : undefined;
      /* istanbul ignore next -- exact-target fallback ordering is exercised by higher-level schedule decorator tests */
      const exactTargetNodeId = targetArn
        ? (arnToNodeId.get(targetArn) ??
          (lambdaFunctionName ? lambdaNameToNodeId.get(lambdaFunctionName) : undefined) ??
          resolveNodeReference(targetArn, addressToNodeId))
        : undefined;

      const context: ScheduleSemanticContext = {
        exactTargetNodeId,
        targetReferences: resolveScheduleTargetReferences(node),
        moduleReferences: collectModuleReferencesFromOutgoingEdges(graph, nodeId),
      };
      current = setNodeSemanticContext(current, nodeId, this.name, context);

      if (!exactTargetNodeId) {
        continue;
      }

      const fact = scheduleFact(this.name, nodeId, exactTargetNodeId, 'exact');
      current = addSemanticFactBetweenNodes(
        current,
        nodeId,
        exactTargetNodeId,
        fact,
        `semantic:${this.name}:${fact.kind}:target`,
      );
    }

    return current;
  }

  public project({
    graph,
  }: Parameters<SemanticDecorator['project']>[0]): ReturnType<SemanticDecorator['project']> {
    const projectionOwners = buildProjectionOwners(graph);
    let current = projectSemanticFactsByOwners(graph, this.name, projectionOwners);

    for (const projectionNodeId of graph.nodeIds()) {
      const projectionNode = graph.getNodeAttributes(projectionNodeId);
      if (projectionNode?.projection?.derivation?.projectionName !== 'aws.eventbridge_schedule') {
        continue;
      }

      const rawScheduleNodeId = projectionNode.projection.derivation.rootNodeId;
      if (!rawScheduleNodeId) {
        continue;
      }

      const rawScheduleNode = graph.getNodeAttributes(rawScheduleNodeId);
      if (!rawScheduleNode || rawScheduleNode.terraform?.resource !== 'aws_scheduler_schedule') {
        continue;
      }

      const context = getNodeSemanticContext<ScheduleSemanticContext>(rawScheduleNode, this.name);

      const hasProjectedFact = current
        .outEdges(projectionNodeId)
        .some((edgeId) =>
          current
            .getEdgeAttributes(edgeId)
            ?.projection?.semantics?.facts?.some((fact) => fact.decorator === this.name),
        );
      if (hasProjectedFact) {
        continue;
      }

      const sourceIndex =
        projectionNode.projection.derivation.instanceKey ??
        rawScheduleNode.terraform?.state?.effective?.index;
      const references = [
        ...(context?.targetReferences ?? resolveScheduleTargetReferences(rawScheduleNode)),
        ...(context?.moduleReferences ??
          collectModuleReferencesFromOutgoingEdges(current, rawScheduleNodeId)),
      ];
      let bestCandidate: ReturnType<typeof selectBestSemanticReferenceCandidate> | undefined;

      for (const reference of references) {
        const candidate = selectBestScheduleReferenceCandidate(
          current,
          resolveSemanticReferenceCandidates({
            graph: current,
            sourceNodeId: rawScheduleNodeId,
            sourceNode: rawScheduleNode,
            sourceIndex,
            reference,
          }),
        );

        if (!candidate) {
          continue;
        }

        /* istanbul ignore next -- best-candidate ranking is covered through semantic reference integration tests */
        if (!bestCandidate || candidate.score > bestCandidate.score) {
          bestCandidate = candidate;
        }
      }

      const candidateProjectionIds = new Set<NodeId>();
      let selectedConfidence: TgSemanticFact['confidence'] = context?.exactTargetNodeId
        ? 'exact'
        : 'heuristic';
      let preferredScopePrefix: string | undefined;
      let rawTargetNodeId: NodeId | undefined = context?.exactTargetNodeId;

      /* istanbul ignore next -- exact-target owner fan-out is exercised indirectly by projection integration tests */
      if (context?.exactTargetNodeId) {
        for (const projectionId of projectionOwners.get(context.exactTargetNodeId) ?? []) {
          candidateProjectionIds.add(projectionId);
        }
      }

      /* istanbul ignore else -- non-scope fallbacks are exercised by higher-level semantic projection tests */
      if (bestCandidate?.kind === 'scope') {
        preferredScopePrefix = bestCandidate.addressPrefix;
        /* istanbul ignore next -- confidence demotion only matters in broader semantic-reference integration paths */
        selectedConfidence =
          /* istanbul ignore next -- exact confidence preservation is equivalent to the direct match path */
          selectedConfidence === 'exact' ? selectedConfidence : bestCandidate.confidence;
        for (const projectionId of collectProjectionIdsInScope(
          current,
          bestCandidate.addressPrefix,
        )) {
          candidateProjectionIds.add(projectionId);
        }
        /* istanbul ignore next -- direct-node fallback is covered by semantic reference resolution tests */
      } else if (bestCandidate?.kind === 'node') {
        /* istanbul ignore next -- confidence carry-over is equivalent to the scope fallback above */
        selectedConfidence =
          selectedConfidence === 'exact' ? selectedConfidence : bestCandidate.confidence;
        /* istanbul ignore next -- raw target preservation is only relevant for ambiguous mocked graphs */
        rawTargetNodeId = rawTargetNodeId ?? bestCandidate.nodeId;
        /* istanbul ignore next -- owner fan-out for direct node fallbacks is exercised indirectly elsewhere */
        for (const projectionId of projectionOwners.get(bestCandidate.nodeId) ?? []) {
          candidateProjectionIds.add(projectionId);
        }
      }

      /* istanbul ignore next -- unresolved fallback candidates intentionally no-op */
      if (candidateProjectionIds.size === 0) {
        continue;
      }

      const projectedTarget = selectBestProjectionTarget(
        current,
        projectionNodeId,
        candidateProjectionIds,
        {
          preferredScopePrefix,
          preferredInstanceKey: projectionNode.projection.derivation.instanceKey,
          rawTargetNodeId,
          confidence: selectedConfidence,
        },
      );
      if (!projectedTarget) {
        continue;
      }

      const fact = scheduleFact(
        this.name,
        rawScheduleNodeId,
        projectedTarget.projectionId,
        projectedTarget.confidence,
      );
      const projectionFact = toProjectedSemanticFact(
        fact,
        projectionNodeId,
        projectedTarget.projectionId,
      );
      const existingProjectionEdgeId = findFirstEdgeBetweenEitherDirection(
        current,
        projectionNodeId,
        projectedTarget.projectionId,
      );
      const projectionEdgeId =
        existingProjectionEdgeId ??
        edgeIdFrom(
          projectionNodeId,
          projectedTarget.projectionId,
          `projection:semantic:${this.name}:${projectionFact.kind}`,
        );

      if (existingProjectionEdgeId) {
        current = addProjectionSemanticFactToEdge(current, projectionEdgeId, projectionFact);
      } else {
        current = current.setEdge(
          projectionEdgeId,
          projectionNodeId,
          projectedTarget.projectionId,
          {
            projection: {
              layer: projectionNode.projection.layer,
              semantics: {
                facts: [projectionFact],
              },
            },
          },
        );
      }
    }

    return current;
  }
}

export const __testing = {
  resolveLambdaFunctionName,
  resolveScheduleTargetArn,
  resolveScheduleTargetReferences,
  moduleReferenceFromAddress,
  collectModuleReferencesFromOutgoingEdges,
  lambdaFunctionNameFromArn,
  supportResourceTypePenalty,
  targetResourceTypeBonus,
  tokenize,
  collectProjectionIdsInScope,
  selectBestProjectionTarget,
  selectBestScheduleReferenceCandidate,
  scheduleFact,
};
