import {
  type AdapterOperations,
  type BaseRule,
  GraphologyAdapter,
  TG_SCHEMA_VERSION,
  type TgGraph,
  asEdgeId,
  asNodeId,
} from '@terra-graph/core';
import ec2CleanupRuleSet from './ec2.js';

const buildAdapter = (graph: TgGraph): AdapterOperations => {
  return new GraphologyAdapter().withTgGraph(graph);
};

const applyRuleAcrossNodes = (rule: BaseRule, adapter: AdapterOperations): AdapterOperations => {
  let updated = adapter;

  for (const nodeId of updated.nodeIds()) {
    const node = updated.getNodeAttributes(nodeId);
    if (!node) {
      continue;
    }

    rule.match(nodeId, node, updated);
    updated = rule.apply(nodeId, node, updated);
  }

  return updated;
};

describe('ec2CleanupRuleSet', () => {
  it('shoud remove aws_launch_template nodes during cleanup', () => {
    const [rule] = ec2CleanupRuleSet.resolvePhases()[0] ?? [];
    if (!rule) {
      throw new Error('Expected cleanup rule');
    }

    const asgId = asNodeId('resource.aws_autoscaling_group.app');
    const launchTemplateId = asNodeId('resource.aws_launch_template.app');

    const updated = applyRuleAcrossNodes(
      rule,
      buildAdapter({
        schemaVersion: TG_SCHEMA_VERSION,
        description: {},
        nodes: {
          [asgId]: {
            id: asgId,
            terraform: {
              kind: 'resource',
              address: 'aws_autoscaling_group.app',
              resource: 'aws_autoscaling_group',
              name: 'app',
            },
          },
          [launchTemplateId]: {
            id: launchTemplateId,
            terraform: {
              kind: 'resource',
              address: 'aws_launch_template.app',
              resource: 'aws_launch_template',
              name: 'app',
            },
          },
        },
        edges: [
          {
            id: asEdgeId('edge-asg-launch-template'),
            from: asgId,
            to: launchTemplateId,
            attributes: {},
          },
        ],
      }),
    );

    expect(updated.getNodeAttributes(launchTemplateId)).toBeUndefined();
    expect(updated.getNodeAttributes(asgId)).toBeDefined();
    expect(updated.outEdges(asgId)).toHaveLength(0);
  });
});
