import {
  type AdapterOperations,
  type BaseRule,
  type EdgeRuleQuery,
  type NodeId,
  NodeRule,
  ProjectionAdjacencyRelationship,
  ProjectionSemanticFactRelationship,
  type SerializedRule,
  type TgNodeAttributes,
} from '@terra-graph/core';
import type {
  ProjectionAdjacencyRelationshipRule,
  ProjectionPluginOptions,
  ProjectionSemanticRelationshipRule,
} from './ProjectionPluginOptions.js';

type ProjectionRuleOptionsProvider = {
  getRuleOptions(context?: {
    graph?: AdapterOperations;
    nodeId?: NodeId;
  }): ProjectionPluginOptions | Promise<ProjectionPluginOptions>;
};

type ProjectionRelationshipRuleOptionsInput =
  | ProjectionPluginOptions
  | ProjectionRuleOptionsProvider;

type DynamicProjectionRelationshipRulesConfig = {
  node: unknown;
  options?: Record<string, unknown>;
};

const isProjectionRuleOptionsProvider = (
  value: ProjectionRelationshipRuleOptionsInput,
): value is ProjectionRuleOptionsProvider =>
  typeof (value as ProjectionRuleOptionsProvider).getRuleOptions === 'function';

const resolveProjectionRuleOptions = (
  value: ProjectionRelationshipRuleOptionsInput,
  context: {
    graph?: AdapterOperations;
    nodeId?: NodeId;
  },
): ProjectionPluginOptions | Promise<ProjectionPluginOptions> =>
  isProjectionRuleOptionsProvider(value) ? value.getRuleOptions(context) : value;

export class DynamicProjectionRelationshipRules extends NodeRule {
  private readonly optionsInput: ProjectionRelationshipRuleOptionsInput;

  constructor(config: DynamicProjectionRelationshipRulesConfig);
  constructor(optionsInput: ProjectionRelationshipRuleOptionsInput);
  constructor(
    input: DynamicProjectionRelationshipRulesConfig | ProjectionRelationshipRuleOptionsInput,
  ) {
    super({
      node: { any: true as const },
    });
    this.optionsInput = this.isSerializedConfig(input)
      ? ((input.options ?? { projections: [] }) as ProjectionPluginOptions)
      : input;
  }

  public override apply(
    nodeId: NodeId,
    node: TgNodeAttributes,
    graph: AdapterOperations,
  ): AdapterOperations {
    if (!this.wasMatched(nodeId)) {
      return graph;
    }

    const options = resolveProjectionRuleOptions(this.optionsInput, {
      graph,
      nodeId,
    });
    if (options instanceof Promise) {
      return options.then((resolved) =>
        this.applyRelationshipRules(nodeId, node, graph, resolved),
      ) as unknown as AdapterOperations;
    }

    return this.applyRelationshipRules(nodeId, node, graph, options);
  }

  public override serialize(): SerializedRule {
    return {
      id: DynamicProjectionRelationshipRules.name,
      config: {
        node: { any: true },
        options: this.optionsInput as unknown as Record<string, unknown>,
      },
    };
  }

  private applyRelationshipRules(
    nodeId: NodeId,
    node: TgNodeAttributes,
    graph: AdapterOperations,
    options: ProjectionPluginOptions,
  ): AdapterOperations {
    return this.relationshipRules(options).reduce((updated, rule) => {
      if (!rule.match(nodeId, node, updated) || !rule.supports(updated)) {
        return updated;
      }

      const result = rule.apply(nodeId, node, updated);
      /* istanbul ignore if -- current child relationship rules are synchronous. */
      if (result instanceof Promise) {
        throw new Error(
          `Rule '${DynamicProjectionRelationshipRules.name}' cannot apply asynchronous child relationship rules`,
        );
      }

      return result;
    }, graph);
  }

  private relationshipRules(options: ProjectionPluginOptions): BaseRule[] {
    return [
      ...(options.semanticRelationships ?? []).map(
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
      ),
      ...(options.adjacencyRelationships ?? []).map(
        (relationship) =>
          new ProjectionAdjacencyRelationship({
            edge: this.toAdjacencyEdgeQuery(relationship),
            options: {
              relation: relationship.relation,
              overwrite: relationship.overwrite ?? true,
              enforceDirection: relationship.enforceDirection ?? true,
            },
          }),
      ),
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

  private isSerializedConfig(
    input: DynamicProjectionRelationshipRulesConfig | ProjectionRelationshipRuleOptionsInput,
  ): input is DynamicProjectionRelationshipRulesConfig {
    return (
      input !== null &&
      typeof input === 'object' &&
      'node' in input &&
      !('projections' in input) &&
      !('getRuleOptions' in input)
    );
  }
}

NodeRule.register(DynamicProjectionRelationshipRules);
