import { RemoveNode, RuleSet } from '@terra-graph/core';

export const ec2CleanupRuleSet = new RuleSet({
  rules: [
    new RemoveNode({
      node: {
        attr: {
          key: 'terraform.resource',
          eq: 'aws_launch_template',
        },
      },
    }),
  ],
});

export default ec2CleanupRuleSet;
