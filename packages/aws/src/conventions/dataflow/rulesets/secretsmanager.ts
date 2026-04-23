import { EdgeDirectionSemantic, RuleSet } from '@terra-graph/core';
import { AwsEdgeDirectionSemantics } from '../edgeSemantics.js';

export const secretsManagerSemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeDirectionSemantic({
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
        semantic: AwsEdgeDirectionSemantics.Accesses,
        enforceDirection: true,
      },
    }),
  ],
});

export default secretsManagerSemanticsRuleSet;
