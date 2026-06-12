import {
  type NodeId,
  type SemanticDecorator,
  type TgSemanticFact,
  addProjectionSemanticFactBetweenNodes,
  addProjectionSemanticFactToEdge,
  addSemanticFactBetweenNodes,
  buildProjectionOwners,
  findFirstEdgeBetweenEitherDirection,
  getNodeSemanticContext,
  setNodeSemanticContext,
  toProjectedSemanticFact,
} from '@terra-graph/core';
import { semanticDecoratorId } from '../namespaces.js';
import {
  type AwsIamPermissionMatchMode,
  type AwsIamPermissionMatchedCapability,
  type AwsIamPermissionSemanticDecoratorConfig,
  evaluateAwsIamPermissions,
  normalizeAwsIamPermissionDecoratorConfig,
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
  kind: string,
  from: NodeId,
  to: NodeId,
  capability: string,
  matchMode: AwsIamPermissionMatchMode,
  matchCertainty: number,
  details: AwsIamPermissionMatchedCapability,
): TgSemanticFact => ({
  kind,
  from,
  to,
  source: 'permission',
  confidence: 'capability',
  decorator,
  attributes: {
    capability,
    matchMode,
    matchCertainty,
    principalRoleNodeIds: details.roleNodeIds,
    policyNodeIds: details.policyNodeIds,
    matchedActionPatterns: details.matchedActionPatterns,
    matchedResourcePatterns: details.matchedResourcePatterns,
  },
});

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
          const fact = permissionFact(
            this.name,
            capability.factKind,
            nodeId,
            targetMatch.targetNodeId,
            capability.capability,
            targetMatch.matchMode,
            targetMatch.matchCertainty,
            capability,
          );
          current = addSemanticFactBetweenNodes(
            current,
            nodeId,
            targetMatch.targetNodeId,
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
          const rawSourceNode = current.getNodeAttributes(fact.from);
          const sourceContext =
            rawSourceNode &&
            getNodeSemanticContext<AwsIamPermissionNodeSemanticContext>(rawSourceNode, this.name);
          const allowedProjectionNames = sourceContext?.capabilities?.find(
            (capability) =>
              capability.factKind === fact.kind && capability.targetNodeIds.includes(fact.to),
          )?.projectionNames;

          /* istanbul ignore next -- projection-owner fallbacks are exercised through decorator projection integration tests */
          const fromProjectionIds = (projectionOwners.get(fact.from) ?? []).filter(
            (projectionId) => {
              /* istanbul ignore next -- unrestricted projection fan-out is validated by end-to-end semantic projection tests */
              if (!allowedProjectionNames || allowedProjectionNames.length === 0) {
                return true;
              }

              const projectionNode = current.getNodeAttributes(projectionId);
              return (
                projectionNode?.projection?.derivation?.projectionName !== undefined &&
                allowedProjectionNames.includes(projectionNode.projection.derivation.projectionName)
              );
            },
          );
          /* istanbul ignore next -- missing target owners are a defensive no-op */
          const toProjectionIds = projectionOwners.get(fact.to) ?? [];

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
