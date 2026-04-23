import { EdgeDirectionSemantic, RuleSet } from '@terra-graph/core';
import { AwsEdgeDirectionSemantics } from '../edgeSemantics.js';

export const wafSemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeDirectionSemantic({
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
        semantic: AwsEdgeDirectionSemantics.Authorizes,
        enforceDirection: true,
      },
    }),
    new EdgeDirectionSemantic({
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
        semantic: AwsEdgeDirectionSemantics.Authorizes,
        enforceDirection: true,
      },
    }),
    new EdgeDirectionSemantic({
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
        semantic: AwsEdgeDirectionSemantics.ObservedBy,
        enforceDirection: true,
      },
    }),
    new EdgeDirectionSemantic({
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
        semantic: AwsEdgeDirectionSemantics.Invokes,
        enforceDirection: true,
      },
    }),
  ],
});

export default wafSemanticsRuleSet;
