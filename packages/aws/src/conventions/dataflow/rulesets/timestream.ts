import { EdgeDirectionSemantic, RuleSet } from '@terra-graph/core';
import { AwsEdgeDirectionSemantics } from '../edgeSemantics.js';

export const timestreamSemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeDirectionSemantic({
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
        semantic: AwsEdgeDirectionSemantics.Routes,
        enforceDirection: true,
      },
    }),
  ],
});

export default timestreamSemanticsRuleSet;
