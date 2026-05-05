import { EdgeSemantic, RuleSet } from '@terra-graph/core';
import { AwsEdgeSemantics } from '../edgeSemantics.js';

export const iamSemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            startsWith: 'aws_iam_',
          },
        },
        to: {
          any: true,
        },
      },
      options: {
        semantic: AwsEdgeSemantics.Authorizes,
        enforceDirection: true,
      },
    }),
    new EdgeSemantic({
      edge: {
        from: {
          and: [
            {
              attr: {
                key: 'terraform.resource',
                endsWith: '_policy',
              },
            },
            {
              not: {
                attr: {
                  key: 'terraform.resource',
                  startsWith: 'aws_iam_',
                },
              },
            },
          ],
        },
        to: {
          any: true,
        },
      },
      options: {
        semantic: AwsEdgeSemantics.Authorizes,
        enforceDirection: true,
      },
    }),
  ],
});

export default iamSemanticsRuleSet;
