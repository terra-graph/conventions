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
});
