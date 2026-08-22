import {
  ApplyProjectionEdgeSemantics,
  ApplySemanticDecorators,
  DeriveProjectionGraph,
  type EdgeRuleQuery,
  MaterializeProjectionInstances,
  type PhasePlan,
  ProjectionAdjacencyRelationship,
  ProjectionInstanceStrategies,
  ProjectionSemanticFactRelationship,
  resolveSemanticDecorators,
} from '@terra-graph/core';
import type {
  ProjectionAdjacencyRelationshipRule,
  ProjectionPluginOptions,
  ProjectionSemanticRelationshipRule,
} from './ProjectionPluginOptions.js';

export type ProjectionRuleOptionsInput = ProjectionPluginOptions | ProjectionRuleOptionsProvider;

export type ProjectionRuleOptionsProvider = {
  getRuleOptions(): ProjectionPluginOptions;
};

const isProjectionRuleOptionsProvider = (
  value: ProjectionRuleOptionsInput,
): value is ProjectionRuleOptionsProvider =>
  typeof (value as ProjectionRuleOptionsProvider).getRuleOptions === 'function';

export class ProjectionPipelineBuilder {
  public build(
    options: ProjectionPluginOptions,
    ruleOptions: ProjectionRuleOptionsInput = options,
  ): PhasePlan {
    const semanticDecorators = resolveSemanticDecorators(options.semanticDecorators);
    const semanticRelationshipRules = options.semanticRelationships?.map(
      (relationship) =>
        new ProjectionSemanticFactRelationship({
          edge: this.toSemanticEdgeQuery(relationship),
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
          edge: this.toAdjacencyEdgeQuery(relationship),
          options: {
            relation: relationship.relation,
            overwrite: relationship.overwrite ?? true,
            enforceDirection: relationship.enforceDirection ?? true,
          },
        }),
    );

    return [
      {
        phase: 'projection',
        rules: [
          new DeriveProjectionGraph({
            options: this.toDeriveRuleOptions(ruleOptions),
          }),
        ],
      },
      {
        phase: 'projection',
        rules: [
          new MaterializeProjectionInstances({
            options: ruleOptions,
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
    ];
  }

  private toAdjacencyEdgeQuery({
    relation: _relation,
    overwrite: _overwrite,
    enforceDirection: _enforceDirection,
    ...edge
  }: ProjectionAdjacencyRelationshipRule): EdgeRuleQuery {
    return edge as EdgeRuleQuery;
  }

  private toSemanticEdgeQuery({
    fact: _fact,
    relation: _relation,
    overwrite: _overwrite,
    enforceDirection: _enforceDirection,
    ...edge
  }: ProjectionSemanticRelationshipRule): EdgeRuleQuery {
    return Object.keys(edge).length === 0 ? { any: true } : (edge as EdgeRuleQuery);
  }

  private toDeriveRuleOptions(ruleOptions: ProjectionRuleOptionsInput): ProjectionRuleOptionsInput {
    if (!isProjectionRuleOptionsProvider(ruleOptions)) {
      return {
        ...ruleOptions,
        instanceStrategy: ProjectionInstanceStrategies.None,
      };
    }

    return {
      getRuleOptions: () => ({
        ...ruleOptions.getRuleOptions(),
        instanceStrategy: ProjectionInstanceStrategies.None,
      }),
    };
  }
}
