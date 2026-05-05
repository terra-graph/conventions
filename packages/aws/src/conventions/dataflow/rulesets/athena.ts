import { EdgeSemantic, RuleSet } from '@terra-graph/core';
import { AwsEdgeSemantics } from '../edgeSemantics.js';

export const athenaSemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_athena_named_query'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            startsWith: ['aws_glue_catalog_database'],
          },
        },
      },
      options: {
        semantic: AwsEdgeSemantics.Accesses,
        enforceDirection: true,
      },
    }),
  ],
});

export default athenaSemanticsRuleSet;
