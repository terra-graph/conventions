import { EdgeDirectionSemantic, RuleSet } from '@terra-graph/core';
import { AwsEdgeDirectionSemantics } from '../edgeSemantics.js';

export const acmSemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeDirectionSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_acm_certificate_validation'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_cloudfront_distribution'],
          },
        },
      },
      options: {
        semantic: AwsEdgeDirectionSemantics.Authorizes,
        enforceDirection: true,
      },
    }),
  ],
});

export default acmSemanticsRuleSet;
