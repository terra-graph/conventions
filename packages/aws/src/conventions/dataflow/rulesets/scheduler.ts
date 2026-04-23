import { EdgeDirectionSemantic, RuleSet } from '@terra-graph/core';
import { AwsEdgeDirectionSemantics } from '../edgeSemantics.js';

export const schedulerSemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeDirectionSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_scheduler_schedule'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_lambda_event_source_mapping'],
          },
        },
      },
      options: {
        semantic: AwsEdgeDirectionSemantics.Invokes,
        enforceDirection: true,
      },
    }),
  ],
});

export default schedulerSemanticsRuleSet;
