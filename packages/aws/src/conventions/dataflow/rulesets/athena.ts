import { EdgeDirectionSemantic, RuleSet } from '@terra-graph/core';
import { AwsEdgeDirectionSemantics } from '../edgeSemantics.js';

export const athenaSemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeDirectionSemantic({
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
        semantic: AwsEdgeDirectionSemantics.Accesses,
        enforceDirection: true,
      },
    }),
  ],
});

export default athenaSemanticsRuleSet;
