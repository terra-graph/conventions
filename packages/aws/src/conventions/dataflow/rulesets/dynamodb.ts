import { EdgeDirectionSemantic, RuleSet } from '@terra-graph/core';
import { AwsEdgeDirectionSemantics } from '../edgeSemantics.js';

export const dynamodbSemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeDirectionSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_dynamodb_table'],
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
            in: ['aws_dynamodb_table'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_dynamodb_table_item'],
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

export default dynamodbSemanticsRuleSet;
