import { EdgeSemantic, RuleSet } from '@terra-graph/core';
import { AwsEdgeSemantics } from '../edgeSemantics.js';

export const wafSemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_wafv2_ip_set'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_wafv2_web_acl'],
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
            in: ['aws_wafv2_web_acl'],
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
            in: ['aws_wafv2_web_acl'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_wafv2_web_acl_logging_configuration'],
          },
        },
      },
      options: {
        semantic: AwsEdgeSemantics.ObservedBy,
        enforceDirection: true,
      },
    }),
    new EdgeSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_wafv2_web_acl_logging_configuration'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_kinesis_firehose_delivery_stream'],
          },
        },
      },
      options: {
        semantic: AwsEdgeSemantics.Invokes,
        enforceDirection: true,
      },
    }),
  ],
});

export default wafSemanticsRuleSet;
