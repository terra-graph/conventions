import {
  type EdgeId,
  type NodeId,
  type SemanticDecorator,
  type TgSemanticFact,
  addProjectionSemanticFactBetweenNodes,
  addProjectionSemanticFactToEdge,
  addSemanticFactBetweenNodes,
  buildProjectionOwners,
  getNodeSemanticContext,
  setNodeSemanticContext,
  toProjectedSemanticFact,
} from '@terra-graph/core';
import { semanticDecoratorId } from '../namespaces.js';
import {
  type AwsIamPermissionMatchMode,
  type AwsIamPermissionMatchedCapability,
  type AwsIamPermissionResolvedFactEndpoints,
  type AwsIamPermissionSemanticDecoratorConfig,
  evaluateAwsIamPermissions,
  normalizeAwsIamPermissionDecoratorConfig,
  resolveCapabilityFactEndpoints,
  shouldEvaluateSubject,
  subjectProjectionNamesFor,
} from './IamEvaluation/AwsIamPermissionEvaluation.js';
import { AWS_IAM_PERMISSION_CAPABILITIES } from './IamEvaluation/Capabailities.js';

export type {
  AwsIamPermissionMatchMode,
  AwsIamPermissionSemanticDecoratorConfig,
  AwsIamPermissionSubjectConfig,
} from './IamEvaluation/AwsIamPermissionEvaluation.js';

type AwsIamPermissionNodeSemanticContext = {
  resourceType?: string;
  roleNodeIds?: NodeId[];
  policyNodeIds?: NodeId[];
  skippedPolicies?: string[];
  capabilities?: Array<
    AwsIamPermissionMatchedCapability & {
      projectionNames?: string[];
    }
  >;
};

const permissionFact = (
  decorator: string,
  endpoints: AwsIamPermissionResolvedFactEndpoints,
  capability: string,
  matchMode: AwsIamPermissionMatchMode,
  matchCertainty: number,
  details: AwsIamPermissionMatchedCapability,
): TgSemanticFact => ({
  kind: endpoints.kind,
  from: endpoints.from,
  to: endpoints.to,
  source: 'permission',
  confidence: 'capability',
  decorator,
  attributes: {
    capability,
    subjectNodeId: endpoints.subjectNodeId,
    targetNodeId: endpoints.targetNodeId,
    matchMode,
    matchCertainty,
    principalRoleNodeIds: details.roleNodeIds,
    policyNodeIds: details.policyNodeIds,
    matchedActionPatterns: details.matchedActionPatterns,
    matchedResourcePatterns: details.matchedResourcePatterns,
  },
});

const nodeIdAttribute = (value: unknown): NodeId | undefined =>
  typeof value === 'string' ? (value as NodeId) : undefined;

const filterProjectionIdsByAllowedNames = (
  current: Parameters<SemanticDecorator['project']>[0]['graph'],
  projectionIds: NodeId[],
  allowedProjectionNames: string[] | undefined,
): NodeId[] =>
  projectionIds.filter((projectionId) => {
    /* istanbul ignore next -- unrestricted projection fan-out is validated by end-to-end semantic projection tests */
    if (!allowedProjectionNames || allowedProjectionNames.length === 0) {
      return true;
    }

    const projectionNode = current.getNodeAttributes(projectionId);
    return (
      projectionNode?.projection?.derivation?.projectionName !== undefined &&
      allowedProjectionNames.includes(projectionNode.projection.derivation.projectionName)
    );
  });

const findDirectedEdge = (
  graph: Parameters<SemanticDecorator['project']>[0]['graph'],
  from: NodeId,
  to: NodeId,
): EdgeId | undefined => graph.outEdges(from).find((edgeId) => graph.edgeTarget(edgeId) === to);

export class AwsIamPermissionSemanticDecorator implements SemanticDecorator {
  public static readonly id = semanticDecoratorId(AwsIamPermissionSemanticDecorator.name);

  public readonly name = AwsIamPermissionSemanticDecorator.id;

  private readonly config: AwsIamPermissionSemanticDecoratorConfig;

  constructor(config?: unknown) {
    this.config = normalizeAwsIamPermissionDecoratorConfig(config);
  }

  public extract({
    graph,
  }: Parameters<SemanticDecorator['extract']>[0]): ReturnType<SemanticDecorator['extract']> {
    /* istanbul ignore next -- default capability expansion is covered indirectly by integration tests */
    const capabilities =
      this.config.capabilities && this.config.capabilities.length > 0
        ? this.config.capabilities
        : [...AWS_IAM_PERMISSION_CAPABILITIES()];

    let current = graph;

    for (const nodeId of graph.nodeIds()) {
      const node = graph.getNodeAttributes(nodeId);
      if (!node || !shouldEvaluateSubject(this.config, node)) {
        continue;
      }

      const evaluation = evaluateAwsIamPermissions({
        graph: current,
        subjectNodeId: nodeId,
        capabilities,
      });
      const projectionNames = subjectProjectionNamesFor(this.config, node.terraform?.resource);

      const context: AwsIamPermissionNodeSemanticContext = {
        resourceType: node.terraform?.resource,
        roleNodeIds: evaluation.roleNodeIds,
        policyNodeIds: evaluation.policyNodeIds,
        skippedPolicies: evaluation.skippedPolicies,
        capabilities: evaluation.capabilities.map((capability) => ({
          ...capability,
          projectionNames,
        })),
      };
      current = setNodeSemanticContext(current, nodeId, this.name, context);

      for (const capability of evaluation.capabilities) {
        for (const targetMatch of capability.targetMatches) {
          const endpoints = resolveCapabilityFactEndpoints({
            subjectNodeId: nodeId,
            targetNodeId: targetMatch.targetNodeId,
            capability,
          });
          const fact = permissionFact(
            this.name,
            endpoints,
            capability.capability,
            targetMatch.matchMode,
            targetMatch.matchCertainty,
            capability,
          );
          current = addSemanticFactBetweenNodes(
            current,
            fact.from,
            fact.to,
            fact,
            `semantic:${this.name}:${fact.kind}:${capability.capability}`,
          );
        }
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
    const projectedFactsByPair = new Map<
      string,
      { from: NodeId; to: NodeId; facts: TgSemanticFact[] }
    >();

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
          const subjectNodeId = nodeIdAttribute(fact.attributes?.subjectNodeId) ?? fact.from;
          const targetNodeId = nodeIdAttribute(fact.attributes?.targetNodeId) ?? fact.to;
          const subjectNode = current.getNodeAttributes(subjectNodeId);
          const subjectContext =
            subjectNode &&
            getNodeSemanticContext<AwsIamPermissionNodeSemanticContext>(subjectNode, this.name);
          const allowedProjectionNames = subjectContext?.capabilities?.find(
            (capability) =>
              capability.factKind === fact.kind && capability.targetNodeIds.includes(targetNodeId),
          )?.projectionNames;

          /* istanbul ignore next -- projection-owner fallbacks are exercised through decorator projection integration tests */
          let fromProjectionIds = projectionOwners.get(fact.from) ?? [];
          /* istanbul ignore next -- missing target owners are a defensive no-op */
          let toProjectionIds = projectionOwners.get(fact.to) ?? [];

          if (subjectNodeId === fact.from) {
            fromProjectionIds = filterProjectionIdsByAllowedNames(
              current,
              fromProjectionIds,
              allowedProjectionNames,
            );
          }
          if (subjectNodeId === fact.to) {
            toProjectionIds = filterProjectionIdsByAllowedNames(
              current,
              toProjectionIds,
              allowedProjectionNames,
            );
          }

          for (const fromProjectionId of fromProjectionIds) {
            for (const toProjectionId of toProjectionIds) {
              const projectionFact = toProjectedSemanticFact(
                fact,
                fromProjectionId,
                toProjectionId,
              );
              const pairKey = JSON.stringify({
                from: fromProjectionId,
                to: toProjectionId,
              });
              const pair = projectedFactsByPair.get(pairKey) ?? {
                from: fromProjectionId,
                to: toProjectionId,
                facts: [],
              };
              pair.facts.push(projectionFact);
              projectedFactsByPair.set(pairKey, pair);
            }
          }
        }
      }
    }

    for (const { from, to, facts } of projectedFactsByPair.values()) {
      const factsByKind = new Map<string, TgSemanticFact[]>();
      for (const fact of facts) {
        factsByKind.set(fact.kind, [...(factsByKind.get(fact.kind) ?? []), fact]);
      }

      const kindEntries = [...factsByKind.entries()];
      const existingEdgeId = findDirectedEdge(graph, from, to);

      kindEntries.forEach(([kind, kindFacts], index) => {
        if (existingEdgeId && index === 0) {
          for (const fact of kindFacts) {
            current = addProjectionSemanticFactToEdge(current, existingEdgeId, fact);
          }
          return;
        }

        for (const fact of kindFacts) {
          current = addProjectionSemanticFactBetweenNodes(
            current,
            from,
            to,
            fact,
            `projection:semantic:${this.name}:${kind}`,
          );
        }
      });
    }

    return current;
  }
}
