import { EdgeSemantic, RuleSet } from '@terra-graph/core';
import { AwsEdgeSemantics } from '../edgeSemantics.js';

export const cloudFrontSemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_cloudfront_origin_access_control'],
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
    new EdgeSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_cloudfront_distribution'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_s3_bucket'],
          },
        },
      },
      options: {
        semantic: AwsEdgeSemantics.Accesses,
        enforceDirection: true,
      },
    }),
  ],
});

export default cloudFrontSemanticsRuleSet;
