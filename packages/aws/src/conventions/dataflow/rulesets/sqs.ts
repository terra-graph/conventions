import { EdgeSemantic, RuleSet } from '@terra-graph/core';
import { AwsEdgeSemantics } from '../edgeSemantics.js';

export const sqsSemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeSemantic({
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
        semantic: AwsEdgeSemantics.Triggers,
        enforceDirection: true,
      },
    }),
    new EdgeSemantic({
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
        semantic: AwsEdgeSemantics.Publishes,
        enforceDirection: true,
      },
    }),
  ],
});

export default sqsSemanticsRuleSet;
