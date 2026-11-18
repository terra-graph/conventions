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
import { DynamicProjectionRelationshipRules } from './DynamicProjectionRelationshipRules.js';
import type {
  ProjectionAdjacencyRelationshipRule,
  ProjectionPluginOptions,
  ProjectionSemanticRelationshipRule,
} from './ProjectionPluginOptions.js';

export type ProjectionRuleOptionsInput = ProjectionPluginOptions | ProjectionRuleOptionsProvider;

export type ProjectionRuleOptionsProvider = {
  getRuleOptions(context?: unknown): ProjectionPluginOptions | Promise<ProjectionPluginOptions>;
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
    const dynamicRelationshipRules = this.toDynamicRelationshipRules(ruleOptions);
    const dynamicRelationshipPhase = this.toDynamicRelationshipPhase(dynamicRelationshipRules);
    const semanticRelationshipRules = this.toSemanticRelationshipRules(
      options,
      dynamicRelationshipRules,
    );

    /* istanbul ignore next -- provider-backed builders require the current core runtime and are covered by DynamicProjectionRelationshipRules tests. */
    const adjacencyRelationshipRules =
      dynamicRelationshipRules.length > 0
        ? undefined
        : options.adjacencyRelationships?.map(
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
      ...dynamicRelationshipPhase,
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

  private toSemanticRelationshipRules(
    options: ProjectionPluginOptions,
    dynamicRelationshipRules: DynamicProjectionRelationshipRules[],
  ): ProjectionSemanticFactRelationship[] | undefined {
    /* istanbul ignore if -- provider-backed builders require the current core runtime and are covered by DynamicProjectionRelationshipRules tests. */
    if (dynamicRelationshipRules.length > 0) {
      return undefined;
    }

    return options.semanticRelationships?.map(
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
  }

  private toDynamicRelationshipRules(
    ruleOptions: ProjectionRuleOptionsInput,
  ): DynamicProjectionRelationshipRules[] {
    /* istanbul ignore if -- provider-backed builders require the current core runtime and are covered by DynamicProjectionRelationshipRules tests. */
    if (isProjectionRuleOptionsProvider(ruleOptions)) {
      return [new DynamicProjectionRelationshipRules(ruleOptions)];
    }

    return [];
  }

  private toDynamicRelationshipPhase(rules: DynamicProjectionRelationshipRules[]): PhasePlan {
    /* istanbul ignore if -- provider-backed builders require the current core runtime and are covered by DynamicProjectionRelationshipRules tests. */
    if (rules.length > 0) {
      return [
        {
          phase: 'projection',
          rules,
        },
      ];
    }

    return [];
  }

  private toDeriveRuleOptions(ruleOptions: ProjectionRuleOptionsInput): ProjectionRuleOptionsInput {
    if (!isProjectionRuleOptionsProvider(ruleOptions)) {
      return {
        ...ruleOptions,
        instanceStrategy: ProjectionInstanceStrategies.None,
      };
    }

    return {
      getRuleOptions: (context?: unknown) =>
        this.withSingletonDerivation(ruleOptions.getRuleOptions(context)),
    };
  }

  private withSingletonDerivation(
    options: ProjectionPluginOptions | Promise<ProjectionPluginOptions>,
  ): ProjectionPluginOptions | Promise<ProjectionPluginOptions> {
    if (options instanceof Promise) {
      return options.then((resolved) => ({
        ...resolved,
        instanceStrategy: ProjectionInstanceStrategies.None,
      }));
    }

    return {
      ...options,
      instanceStrategy: ProjectionInstanceStrategies.None,
    };
  }
}
