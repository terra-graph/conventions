import {
  addProjectionSemanticFactBetweenNodes,
  addProjectionSemanticFactToEdge,
  addSemanticFactBetweenNodes,
  buildProjectionOwners,
  findFirstEdgeBetweenEitherDirection,
  getNodeSemanticContext,
  setNodeSemanticContext,
  type NodeId,
  type SemanticDecorator,
  type TgSemanticFact,
  toProjectedSemanticFact,
} from '@terra-graph/core';
import { semanticDecoratorId } from '../namespaces.js';
import {
  AWS_IAM_PERMISSION_CAPABILITIES,
  evaluateAwsIamPermissions,
  normalizeAwsIamPermissionDecoratorConfig,
  shouldEvaluateSubject,
  subjectProjectionNamesFor,
  type AwsIamPermissionCapability,
  type AwsIamPermissionMatchedCapability,
  type AwsIamPermissionSemanticDecoratorConfig,
} from './AwsIamPermissionEvaluation.js';

export type {
  AwsIamPermissionCapability,
  AwsIamPermissionSemanticDecoratorConfig,
  AwsIamPermissionSubjectConfig,
} from './AwsIamPermissionEvaluation.js';

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
  kind: 'writes_to' | 'publishes_to',
  from: NodeId,
  to: NodeId,
  capability: AwsIamPermissionCapability,
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
    principalRoleNodeIds: details.roleNodeIds,
    policyNodeIds: details.policyNodeIds,
    matchedActionPatterns: details.matchedActionPatterns,
    matchedResourcePatterns: details.matchedResourcePatterns,
  },
});

export class AwsIamPermissionSemanticDecorator implements SemanticDecorator {
  public static readonly id = semanticDecoratorId(
    AwsIamPermissionSemanticDecorator.name,
  );

  public readonly name = AwsIamPermissionSemanticDecorator.id;

  private readonly config: AwsIamPermissionSemanticDecoratorConfig;

  constructor(config?: unknown) {
    this.config = normalizeAwsIamPermissionDecoratorConfig(config);
  }

  public extract({
    graph,
  }: Parameters<SemanticDecorator['extract']>[0]): ReturnType<
    SemanticDecorator['extract']
  > {
    const capabilities =
      this.config.capabilities && this.config.capabilities.length > 0
        ? this.config.capabilities
        : [...AWS_IAM_PERMISSION_CAPABILITIES];

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
      const projectionNames = subjectProjectionNamesFor(
        this.config,
        node.terraform?.resource,
      );

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
        for (const targetNodeId of capability.targetNodeIds) {
          const fact = permissionFact(
            this.name,
            capability.factKind,
            nodeId,
            targetNodeId,
            capability.capability,
            capability,
          );
          current = addSemanticFactBetweenNodes(
            current,
            nodeId,
            targetNodeId,
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
  }: Parameters<SemanticDecorator['project']>[0]): ReturnType<
    SemanticDecorator['project']
  > {
    const projectionOwners = buildProjectionOwners(graph);
    let current = graph;
    const visited = new Set<string>();

    for (const rawNodeId of graph.nodeIds()) {
      for (const edgeId of graph.outEdges(rawNodeId)) {
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
          const rawSourceNode = current.getNodeAttributes(fact.from);
          const sourceContext =
            rawSourceNode &&
            getNodeSemanticContext<AwsIamPermissionNodeSemanticContext>(
              rawSourceNode,
              this.name,
            );
          const allowedProjectionNames = sourceContext?.capabilities?.find(
            (capability) =>
              capability.factKind === fact.kind &&
              capability.targetNodeIds.includes(fact.to),
          )?.projectionNames;

          const fromProjectionIds = (projectionOwners.get(fact.from) ?? []).filter(
            (projectionId) => {
              if (!allowedProjectionNames || allowedProjectionNames.length === 0) {
                return true;
              }

              const projectionNode = current.getNodeAttributes(projectionId);
              return (
                projectionNode?.projection?.derivation?.projectionName !==
                  undefined &&
                allowedProjectionNames.includes(
                  projectionNode.projection.derivation.projectionName,
                )
              );
            },
          );
          const toProjectionIds = projectionOwners.get(fact.to) ?? [];

          for (const fromProjectionId of fromProjectionIds) {
            for (const toProjectionId of toProjectionIds) {
              const projectionFact = toProjectedSemanticFact(
                fact,
                fromProjectionId,
                toProjectionId,
              );
              const existingProjectionEdgeId =
                findFirstEdgeBetweenEitherDirection(
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
