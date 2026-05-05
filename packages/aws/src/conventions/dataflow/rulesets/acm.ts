import { EdgeSemantic, RuleSet } from '@terra-graph/core';
import { AwsEdgeSemantics } from '../edgeSemantics.js';

export const acmSemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeSemantic({
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
        semantic: AwsEdgeSemantics.Authorizes,
        enforceDirection: true,
      },
    }),
  ],
});

export default acmSemanticsRuleSet;
