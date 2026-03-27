import { NamedRuleRegistry, RemoveNode } from '@terra-graph/core';
import { ruleName } from '../namespaces.js';

export default new NamedRuleRegistry({
  [ruleName('data.remove')]: new RemoveNode({
    node: {
      or: [
        {
          and: [
            { attr: { key: 'terraform.kind', eq: 'data' } },
            {
              not: {
                attr: {
                  key: 'terraform.resource',
                  in: ['aws_iam_policy_document', 'aws_iam_policy'],
                },
              },
            },
          ],
        },
      ],
    },
  }),
  [ruleName('log_groups.only_event_bridge')]: new RemoveNode({
    node: {
      and: [
        {
          attr: {
            key: 'terraform.resource',
            eq: 'aws_cloudwatch_log_group',
          },
        },
        {
          not: {
            edge: {
              in: {
                attr: {
                  key: 'terraform.resource',
                  eq: 'aws_cloudwatch_event_target',
                },
              },
            },
          },
        },
      ],
    },
  }),
  // TODO: this should probably be part of the convention too?
  [ruleName('lambda.only_event_source_mapping')]: new RemoveNode({
    node: {
      and: [
        { attr: { key: 'terraform.resource', startsWith: 'aws_lambda' } },
        {
          not: {
            attr: {
              key: 'terraform.resource',
              in: [
                'aws_lambda_function',
                'aws_lambda_event_source_mapping',
                'aws_lambda_permission',
              ],
            },
          },
        },
      ],
    },
  }),
});
