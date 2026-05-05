import { EdgeSemantic, RuleSet } from '@terra-graph/core';
import { AwsEdgeSemantics } from '../edgeSemantics.js';

export const secretsManagerSemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_secretsmanager_secret_version'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            startsWith: ['aws_secretsmanager_secret'],
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

export default secretsManagerSemanticsRuleSet;
