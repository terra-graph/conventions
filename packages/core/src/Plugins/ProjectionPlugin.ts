import {
  ApplyProjectionEdgeSemantics,
  DeriveProjectionGraph,
  type EdgeRuleQuery,
  GraphPlugin,
  type GraphPluginBuildInput,
  type GraphPluginBuildResult,
  MaterializeProjectionInstances,
  ProjectionInstanceStrategies,
  ProjectionRelationshipSemantic,
} from '@terra-graph/core';
import { pluginId } from '../namespaces.js';

type ProjectionRelationshipRule = EdgeRuleQuery & {
  relation: string;
  overwrite?: boolean;
  enforceDirection?: boolean;
};

export type ProjectionInstanceStrategyName = 'none' | 'match_by_key';

export type ProjectionPluginOptions = {
  projections: unknown[];
  relationships?: ProjectionRelationshipRule[];
  instanceStrategy?: ProjectionInstanceStrategyName;
};

export class ProjectionPlugin extends GraphPlugin<ProjectionPluginOptions> {
  static id = pluginId(ProjectionPlugin.name);

  constructor() {
    super(ProjectionPlugin.id, {
      projections: [],
      relationships: [],
      instanceStrategy: 'none',
    });
  }

  public override build({
    options,
  }: GraphPluginBuildInput<ProjectionPluginOptions>): GraphPluginBuildResult {
    const toEdgeQuery = ({
      relation: _relation,
      overwrite: _overwrite,
      enforceDirection: _enforceDirection,
      ...edge
    }: ProjectionRelationshipRule): EdgeRuleQuery => edge as EdgeRuleQuery;

    const relationshipRules = options.relationships?.map(
      (relationship) =>
        new ProjectionRelationshipSemantic({
          edge: toEdgeQuery(relationship),
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
        ...(relationshipRules && relationshipRules.length > 0
          ? [
              {
                phase: 'projection' as const,
                rules: relationshipRules,
              },
            ]
          : []),
        {
          phase: 'projection',
          rules: [
            new MaterializeProjectionInstances({
              options,
            }),
          ],
        },
        {
          phase: 'projection',
          rules: [new ApplyProjectionEdgeSemantics()],
        },
      ],
    };
  }
}
