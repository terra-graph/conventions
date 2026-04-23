import { EdgeDirectionSemantic, RuleSet } from '@terra-graph/core';
import { AwsEdgeDirectionSemantics } from '../edgeSemantics.js';

export const sqsSemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeDirectionSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_sqs_queue'],
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
        semantic: AwsEdgeDirectionSemantics.Triggers,
        enforceDirection: true,
      },
    }),
    new EdgeDirectionSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            eq: 'aws_sqs_queue',
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            eq: 'aws_sqs_queue',
          },
        },
      },
      options: {
        semantic: AwsEdgeDirectionSemantics.Publishes,
        enforceDirection: true,
      },
    }),
  ],
});

export default sqsSemanticsRuleSet;
