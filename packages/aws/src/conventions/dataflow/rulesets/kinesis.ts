import { EdgeDirectionSemantic, RuleSet } from '@terra-graph/core';
import { AwsEdgeDirectionSemantics } from '../edgeSemantics.js';

export const kinesisSemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeDirectionSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_kinesis_stream'],
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
            in: ['aws_kinesis_firehose_delivery_stream'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_cloudwatch_log_stream'],
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

export default kinesisSemanticsRuleSet;
