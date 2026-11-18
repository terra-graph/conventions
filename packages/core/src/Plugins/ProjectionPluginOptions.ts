import type { EdgeRuleQuery, SemanticDecoratorDefinition } from '@terra-graph/core';

export type ProjectionAdjacencyRelationshipRule = EdgeRuleQuery & {
  relation: string;
  overwrite?: boolean;
  enforceDirection?: boolean;
};

export type ProjectionSemanticRelationshipRule = Partial<Record<'from' | 'to', unknown>> & {
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
