import { EdgeSemantic, RuleSet } from '@terra-graph/core';
import { AwsEdgeSemantics } from '../edgeSemantics.js';

export const timestreamSemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_timestreamwrite_database'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_timestreamwrite_table'],
          },
        },
      },
      options: {
        semantic: AwsEdgeSemantics.Routes,
        enforceDirection: true,
      },
    }),
  ],
});

export default timestreamSemanticsRuleSet;
