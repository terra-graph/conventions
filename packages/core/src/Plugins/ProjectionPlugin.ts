import {
  ApplySemanticDecorators,
  ApplyProjectionEdgeSemantics,
  DeriveProjectionGraph,
  type EdgeRuleQuery,
  GraphPlugin,
  type GraphPluginBuildInput,
  type GraphPluginBuildResult,
  MaterializeProjectionInstances,
  ProjectionInstanceStrategies,
  ProjectionAdjacencyRelationship,
  ProjectionSemanticFactRelationship,
  type SemanticDecoratorDefinition,
  resolveSemanticDecorators,
} from '@terra-graph/core';
import { pluginId } from '../namespaces.js';

type ProjectionAdjacencyRelationshipRule = EdgeRuleQuery & {
  relation: string;
  overwrite?: boolean;
  enforceDirection?: boolean;
};

type ProjectionSemanticRelationshipRule = Partial<
  Record<'from' | 'to', unknown>
> & {
  fact: string;
  relation: string;
  overwrite?: boolean;
  enforceDirection?: boolean;
};

export type ProjectionInstanceStrategyName = 'none' | 'match_by_key';

export type ProjectionPluginOptions = {
  projections: unknown[];
  adjacencyRelationships?: ProjectionAdjacencyRelationshipRule[];
  semanticRelationships?: ProjectionSemanticRelationshipRule[];
  semanticDecorators?: SemanticDecoratorDefinition[];
  instanceStrategy?: ProjectionInstanceStrategyName;
};

export class ProjectionPlugin extends GraphPlugin<ProjectionPluginOptions> {
  static id = pluginId(ProjectionPlugin.name);

  constructor() {
    super(ProjectionPlugin.id, {
      projections: [],
      adjacencyRelationships: [],
      semanticRelationships: [],
      semanticDecorators: [],
      instanceStrategy: 'none',
    });
  }

  public override build({
    options,
  }: GraphPluginBuildInput<ProjectionPluginOptions>): GraphPluginBuildResult {
    const semanticDecorators = resolveSemanticDecorators(
      options.semanticDecorators,
    );
    const toAdjacencyEdgeQuery = ({
      relation: _relation,
      overwrite: _overwrite,
      enforceDirection: _enforceDirection,
      ...edge
    }: ProjectionAdjacencyRelationshipRule): EdgeRuleQuery => edge as EdgeRuleQuery;
    const toSemanticEdgeQuery = ({
      fact: _fact,
      relation: _relation,
      overwrite: _overwrite,
      enforceDirection: _enforceDirection,
      ...edge
    }: ProjectionSemanticRelationshipRule): EdgeRuleQuery =>
      (Object.keys(edge).length === 0
        ? { any: true }
        : (edge as EdgeRuleQuery));

    const semanticRelationshipRules = options.semanticRelationships?.map(
      (relationship) =>
        new ProjectionSemanticFactRelationship({
          edge: toSemanticEdgeQuery(relationship),
          options: {
            fact: relationship.fact,
            relation: relationship.relation,
            overwrite: relationship.overwrite ?? true,
            enforceDirection: relationship.enforceDirection ?? true,
          },
        }),
    );

    const adjacencyRelationshipRules = options.adjacencyRelationships?.map(
      (relationship) =>
        new ProjectionAdjacencyRelationship({
          edge: toAdjacencyEdgeQuery(relationship),
          options: {
            relation: relationship.relation,
            overwrite: relationship.overwrite ?? true,
            enforceDirection: relationship.enforceDirection ?? true,
          },
        }),
    );

    return {
      phases: [
        {
          phase: 'projection',
          rules: [
            new DeriveProjectionGraph({
              options: {
                ...options,
                instanceStrategy: ProjectionInstanceStrategies.None,
              },
            }),
          ],
        },
        {
          phase: 'projection',
          rules: [
            new MaterializeProjectionInstances({
              options,
            }),
          ],
        },
        ...(semanticDecorators.length > 0
          ? [
              {
                phase: 'projection' as const,
                rules: [
                  new ApplySemanticDecorators({
                    options: {
                      mode: 'project',
                      decorators: semanticDecorators,
                    },
                  }),
                ],
              },
            ]
          : []),
        ...(semanticRelationshipRules && semanticRelationshipRules.length > 0
          ? [
              {
                phase: 'projection' as const,
                rules: semanticRelationshipRules,
              },
            ]
          : []),
        ...(adjacencyRelationshipRules && adjacencyRelationshipRules.length > 0
          ? [
              {
                phase: 'projection' as const,
                rules: adjacencyRelationshipRules,
              },
            ]
          : []),
        {
          phase: 'projection',
          rules: [new ApplyProjectionEdgeSemantics()],
        },
      ],
    };
  }
}
