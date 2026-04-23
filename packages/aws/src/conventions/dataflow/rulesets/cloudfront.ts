import { EdgeDirectionSemantic, RuleSet } from '@terra-graph/core';
import { AwsEdgeDirectionSemantics } from '../edgeSemantics.js';

export const cloudFrontSemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeDirectionSemantic({
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
        semantic: AwsEdgeDirectionSemantics.Authorizes,
        enforceDirection: true,
      },
    }),
    new EdgeDirectionSemantic({
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
        semantic: AwsEdgeDirectionSemantics.Accesses,
        enforceDirection: true,
      },
    }),
  ],
});

export default cloudFrontSemanticsRuleSet;
