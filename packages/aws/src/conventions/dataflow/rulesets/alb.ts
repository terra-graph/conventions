import {
  type AdapterOperations,
  EdgeSemantic,
  type NodeId,
  NodeRule,
  RemoveNode,
  RuleSet,
  type TgNodeAttributes,
  edgeIdFrom,
} from '@terra-graph/core';
import { AwsEdgeSemantics } from '../edgeSemantics.js';

const LOAD_BALANCER_RESOURCE = 'aws_lb';
const LOAD_BALANCER_LISTENER_RESOURCE = 'aws_lb_listener';
const LOAD_BALANCER_TARGET_GROUP_RESOURCE = 'aws_lb_target_group';
const ALB_DIRECT_ROUTE_TARGET_RESOURCES = new Set(['aws_ecs_service', 'aws_autoscaling_group']);
const ALB_INTERMEDIARY_RESOURCES = new Set([
  LOAD_BALANCER_LISTENER_RESOURCE,
  LOAD_BALANCER_TARGET_GROUP_RESOURCE,
]);

const addressOf = (graph: AdapterOperations, nodeId: NodeId): string | undefined => {
  const node = graph.getNodeAttributes(nodeId);
  return typeof node?.terraform?.address === 'string' ? node.terraform.address : undefined;
};

const scopeIdOf = (graph: AdapterOperations, nodeId: NodeId): string | undefined => {
  const node = graph.getNodeAttributes(nodeId);
  return typeof node?.hints?.topology?.scopeId === 'string' ? node.hints.topology.scopeId : undefined;
};

const isScopeCompatible = (graph: AdapterOperations, sourceId: NodeId, targetId: NodeId): boolean => {
  const sourceScopeId = scopeIdOf(graph, sourceId);
  const targetScopeId = scopeIdOf(graph, targetId);
  if (sourceScopeId && targetScopeId && sourceScopeId !== targetScopeId) {
    return false;
  }
  return true;
};

class MaterializeDirectAlbRoutes extends NodeRule {
  public override apply(
    nodeId: NodeId,
    node: TgNodeAttributes,
    graph: AdapterOperations,
  ): AdapterOperations {
    if (!this.wasMatched(nodeId)) {
      return graph;
    }

    if (node.terraform?.resource !== LOAD_BALANCER_RESOURCE) {
      return graph;
    }

    let updated = graph;
    const collectReachableTargetIds = (startNodeIds: readonly NodeId[]): NodeId[] => {
      const reachableTargetIds = new Set<NodeId>();

      for (const startNodeId of startNodeIds) {
        const queue: Array<{ nodeId: NodeId; depth: number }> = [{ nodeId: startNodeId, depth: 0 }];
        const visited = new Set<NodeId>([startNodeId]);

        while (queue.length > 0) {
          const current = queue.shift();
          if (!current) {
            continue;
          }

          if (current.depth >= 3) {
            continue;
          }

          for (const outEdgeId of updated.outEdges(current.nodeId)) {
            const targetId = updated.edgeTarget(outEdgeId);
            if (targetId === startNodeId) {
              continue;
            }

            const target = updated.getNodeAttributes(targetId);
            if (!target) {
              continue;
            }

            const resource = target.terraform?.resource;
            if (!resource) {
              continue;
            }

            if (ALB_DIRECT_ROUTE_TARGET_RESOURCES.has(resource)) {
              reachableTargetIds.add(targetId);
              continue;
            }

            if (!ALB_INTERMEDIARY_RESOURCES.has(resource) || visited.has(targetId)) {
              continue;
            }

            visited.add(targetId);
            queue.push({ nodeId: targetId, depth: current.depth + 1 });
          }
        }
      }

      return [...reachableTargetIds].sort((left, right) => String(left).localeCompare(String(right)));
    };

    const localTargetIds = collectReachableTargetIds([nodeId]).filter((targetId) =>
      isScopeCompatible(updated, nodeId, targetId),
    );
    if (localTargetIds.length > 0) {
      for (const targetId of localTargetIds) {
        const edgeId = edgeIdFrom(nodeId, targetId, `alb.cleanup.direct-route:${String(targetId)}`);
        updated = updated.setEdge(edgeId, nodeId, targetId, {});
      }

      return updated;
    }

    const currentLoadBalancerAddress = addressOf(graph, nodeId);
    const relatedLoadBalancerIds = [...graph.nodeIds()]
      .filter((candidateNodeId) => {
        const candidateNode = graph.getNodeAttributes(candidateNodeId);
        return (
          candidateNode?.terraform?.resource === LOAD_BALANCER_RESOURCE &&
          addressOf(graph, candidateNodeId) === currentLoadBalancerAddress
        );
      })
      .sort((left, right) => String(left).localeCompare(String(right)));
    const reachableTargetAddresses = new Set<string>();

    for (const targetId of collectReachableTargetIds(relatedLoadBalancerIds)) {
      const targetAddress = addressOf(updated, targetId);
      if (targetAddress) {
        reachableTargetAddresses.add(targetAddress);
      }
    }

    const candidateTargets = [...updated.nodeIds()]
      .filter((targetId) => {
        const target = updated.getNodeAttributes(targetId);
        if (!target || !ALB_DIRECT_ROUTE_TARGET_RESOURCES.has(target.terraform?.resource ?? '')) {
          return false;
        }

        const targetAddress = addressOf(updated, targetId);
        if (!targetAddress || !reachableTargetAddresses.has(targetAddress)) {
          return false;
        }

        return isScopeCompatible(updated, nodeId, targetId);
      })
      .sort((left, right) => String(left).localeCompare(String(right)));

    for (const targetId of candidateTargets) {
      const edgeId = edgeIdFrom(nodeId, targetId, `alb.cleanup.direct-route:${String(targetId)}`);
      updated = updated.setEdge(edgeId, nodeId, targetId, {});
    }

    return updated;
  }
}

export const albSemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_lb'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_lb_listener'],
          },
        },
      },
      options: {
        semantic: AwsEdgeSemantics.Routes,
        enforceDirection: true,
      },
    }),
    new EdgeSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_lb_listener'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_lb_target_group'],
          },
        },
      },
      options: {
        semantic: AwsEdgeSemantics.Routes,
        enforceDirection: true,
      },
    }),
    new EdgeSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_lb'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_ecs_service'],
          },
        },
      },
      options: {
        semantic: AwsEdgeSemantics.Routes,
        enforceDirection: true,
      },
    }),
    new EdgeSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_lb_target_group'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_ecs_service'],
          },
        },
      },
      options: {
        semantic: AwsEdgeSemantics.Routes,
        enforceDirection: true,
      },
    }),
    new EdgeSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_lb_listener'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_ecs_service'],
          },
        },
      },
      options: {
        semantic: AwsEdgeSemantics.Routes,
        enforceDirection: true,
      },
    }),
    new EdgeSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_lb_target_group'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_autoscaling_group'],
          },
        },
      },
      options: {
        semantic: AwsEdgeSemantics.Routes,
        enforceDirection: true,
      },
    }),
  ],
});

export const albCleanupRuleSet = new RuleSet({
  rules: [
    new MaterializeDirectAlbRoutes({
      node: {
        attr: {
          key: 'terraform.resource',
          eq: 'aws_lb',
        },
      },
    }),
    new RemoveNode({
      node: {
        attr: {
          key: 'terraform.resource',
          eq: 'aws_lb_listener',
        },
      },
    }),
    new RemoveNode({
      node: {
        attr: {
          key: 'terraform.resource',
          eq: 'aws_lb_target_group',
        },
      },
    }),
    new EdgeSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_lb'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_ecs_service'],
          },
        },
      },
      options: {
        semantic: AwsEdgeSemantics.Routes,
        enforceDirection: true,
      },
    }),
    new EdgeSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_lb'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_autoscaling_group'],
          },
        },
      },
      options: {
        semantic: AwsEdgeSemantics.Routes,
        enforceDirection: true,
      },
    }),
  ],
});

export default albSemanticsRuleSet;

NodeRule.register(MaterializeDirectAlbRoutes);
