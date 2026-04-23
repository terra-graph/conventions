import { EdgeDirectionSemantic, RuleSet } from '@terra-graph/core';
import { AwsEdgeDirectionSemantics } from '../edgeSemantics.js';

export const iamSemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeDirectionSemantic({
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
        semantic: AwsEdgeDirectionSemantics.Authorizes,
        enforceDirection: true,
      },
    }),
    new EdgeDirectionSemantic({
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
        semantic: AwsEdgeDirectionSemantics.Authorizes,
        enforceDirection: true,
      },
    }),
  ],
});

export default iamSemanticsRuleSet;
