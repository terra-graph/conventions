import { type AdapterOperations, type TgNodeAttributes, asNodeId } from '@terra-graph/core';
import type { PlacementContext } from '../types.js';
import { EcsPlacementEnricher } from './ecs.js';

const buildContext = (graph: AdapterOperations): PlacementContext => ({
  graph,
  vpcs: new Map(),
  subnets: new Map(),
  vpcModulePathToKeys: new Map(),
  vpcIdentifierToKey: new Map(),
  subnetIdentifierToKey: new Map(),
  vpcNodeToKey: new Map(),
  subnetNodeToKey: new Map(),
  groupNameToNodeId: new Map(),
});

describe('EcsPlacementEnricher', () => {
  it('shoud index task definitions without creating family revision aliases when revision is absent', () => {
    const taskDefinitionId = asNodeId('resource.aws_ecs_task_definition.family_only');
    const graph = {
      getNodeAttributes: () => undefined,
      predecessors: () => [],
      successors: () => [],
    } as unknown as AdapterOperations;

    const context = buildContext(graph);

    EcsPlacementEnricher.indexNode?.({
      nodeId: taskDefinitionId,
      node: {} as TgNodeAttributes,
      values: {
        family: 'family-only',
      },
      context,
      resource: 'aws_ecs_task_definition',
      address: 'aws_ecs_task_definition.family_only',
      name: 'family_only',
    });

    const taskDefinitions = context.groupNameToNodeId.get('ecs.task_definition');
    expect(taskDefinitions?.get('family-only')).toBe(taskDefinitionId);
    expect(taskDefinitions?.has('family-only:1')).toBe(false);
  });

  it('shoud index task definitions and resolve subnet placement for awsvpc services', () => {
    const taskDefinitionId = asNodeId('resource.aws_ecs_task_definition.app');
    const serviceId = asNodeId('resource.aws_ecs_service.app');
    const graph = {
      getNodeAttributes: (nodeId: string) => {
        if (nodeId === taskDefinitionId) {
          return {
            terraform: {
              resource: 'aws_ecs_task_definition',
              state: {
                effective: {
                  values: {
                    network_mode: 'awsvpc',
                  },
                },
              },
            },
          } as TgNodeAttributes;
        }

        return undefined;
      },
      predecessors: () => [],
      successors: () => [],
    } as unknown as AdapterOperations;

    const context = buildContext(graph);
    context.subnetIdentifierToKey.set('subnet-a', 'subnet-a');
    context.subnetIdentifierToKey.set('subnet-b', 'subnet-b');

    EcsPlacementEnricher.indexNode?.({
      nodeId: taskDefinitionId,
      node: {} as TgNodeAttributes,
      values: {
        arn: 'arn:aws:ecs:eu-west-2:123456789012:task-definition/app:1',
        family: 'app',
        revision: 1,
      },
      context,
      resource: 'aws_ecs_task_definition',
      address: 'aws_ecs_task_definition.app',
      name: 'app',
    });

    const subnetKeys = new Set<string>();
    const controls: { suppressPlacement?: boolean } = {};

    EcsPlacementEnricher.apply({
      nodeId: serviceId,
      node: {
        terraform: {
          resource: 'aws_ecs_service',
        },
      } as TgNodeAttributes,
      values: {
        task_definition: 'app:1',
        network_configuration: {
          subnets: ['subnet-a', 'subnet-b'],
        },
      },
      context,
      subnetKeys,
      vpcKeys: new Set<string>(),
      explicitVpcId: undefined,
      controls,
    });

    expect(subnetKeys).toStrictEqual(new Set<string>(['subnet-a', 'subnet-b']));
    expect(controls.suppressPlacement).toBeUndefined();
  });

  it('shoud place awsvpc task definitions into the subnets of connected runtime resources', () => {
    const taskDefinitionId = asNodeId('resource.aws_ecs_task_definition.app');
    const serviceId = asNodeId('resource.aws_ecs_service.app');
    const graph = {
      getNodeAttributes: (nodeId: string) => {
        if (nodeId === serviceId) {
          return {
            terraform: {
              resource: 'aws_ecs_service',
              state: {
                effective: {
                  values: {
                    task_definition: 'app:1',
                    network_configuration: {
                      subnets: ['subnet-a', 'subnet-b'],
                    },
                  },
                },
              },
            },
          } as TgNodeAttributes;
        }

        if (nodeId === taskDefinitionId) {
          return {
            terraform: {
              resource: 'aws_ecs_task_definition',
            },
          } as TgNodeAttributes;
        }

        return undefined;
      },
      predecessors: (nodeId: string) => (nodeId === taskDefinitionId ? [serviceId] : []),
      successors: (nodeId: string) => (nodeId === serviceId ? [taskDefinitionId] : []),
    } as unknown as AdapterOperations;

    const context = buildContext(graph);
    context.subnetIdentifierToKey.set('subnet-a', 'subnet-a');
    context.subnetIdentifierToKey.set('subnet-b', 'subnet-b');

    const subnetKeys = new Set<string>();
    const controls: { suppressPlacement?: boolean } = {};

    EcsPlacementEnricher.apply({
      nodeId: taskDefinitionId,
      node: {
        terraform: {
          resource: 'aws_ecs_task_definition',
        },
      } as TgNodeAttributes,
      values: {
        family: 'app',
        revision: 1,
        network_mode: 'awsvpc',
      },
      context,
      subnetKeys,
      vpcKeys: new Set<string>(),
      explicitVpcId: undefined,
      controls,
    });

    expect(subnetKeys).toStrictEqual(new Set<string>(['subnet-a', 'subnet-b']));
    expect(controls.suppressPlacement).toBeUndefined();
  });

  it('shoud ignore missing, irrelevant, and mismatched neighbors when placing task definitions', () => {
    const taskDefinitionId = asNodeId('resource.aws_ecs_task_definition.app');
    const otherTaskDefinitionId = asNodeId('resource.aws_ecs_task_definition.other');
    const missingNeighborId = asNodeId('resource.aws_ecs_service.missing');
    const irrelevantNeighborId = asNodeId('resource.aws_ecs_cluster.irrelevant');
    const mismatchedServiceId = asNodeId('resource.aws_ecs_service.other');
    const graph = {
      getNodeAttributes: (nodeId: string) => {
        if (nodeId === irrelevantNeighborId) {
          return {
            terraform: {
              resource: 'aws_ecs_cluster',
            },
          } as TgNodeAttributes;
        }

        if (nodeId === mismatchedServiceId) {
          return {
            terraform: {
              resource: 'aws_ecs_service',
              state: {
                effective: {
                  values: {
                    task_definition: 'other:1',
                    network_configuration: {
                      subnets: ['subnet-a'],
                    },
                  },
                },
              },
            },
          } as TgNodeAttributes;
        }

        if (nodeId === otherTaskDefinitionId) {
          return {
            terraform: {
              resource: 'aws_ecs_task_definition',
            },
          } as TgNodeAttributes;
        }

        return undefined;
      },
      predecessors: () => [missingNeighborId, irrelevantNeighborId, mismatchedServiceId],
      successors: (nodeId: string) => (nodeId === mismatchedServiceId ? [otherTaskDefinitionId] : []),
    } as unknown as AdapterOperations;

    const context = buildContext(graph);
    context.groupNameToNodeId.set('ecs.task_definition', new Map([['other:1', otherTaskDefinitionId]]));

    const subnetKeys = new Set<string>();
    const controls: { suppressPlacement?: boolean } = {};

    EcsPlacementEnricher.apply({
      nodeId: taskDefinitionId,
      node: {
        terraform: {
          resource: 'aws_ecs_task_definition',
        },
      } as TgNodeAttributes,
      values: {
        family: 'app',
        revision: 1,
        network_mode: 'awsvpc',
      },
      context,
      subnetKeys,
      vpcKeys: new Set<string>(),
      explicitVpcId: undefined,
      controls,
    });

    expect(subnetKeys).toStrictEqual(new Set<string>());
    expect(controls.suppressPlacement).toBeUndefined();
  });

  it('shoud suppress placement when task definitions are missing or not awsvpc', () => {
    const taskDefinitionId = asNodeId('resource.aws_ecs_task_definition.bridge');
    const serviceId = asNodeId('resource.aws_ecs_service.bridge');
    const serviceMissingId = asNodeId('resource.aws_ecs_service.missing');
    const graph = {
      getNodeAttributes: (nodeId: string) => {
        if (nodeId === taskDefinitionId) {
          return {
            terraform: {
              resource: 'aws_ecs_task_definition',
              state: {
                effective: {
                  values: {
                    network_mode: 'bridge',
                  },
                },
              },
            },
          } as TgNodeAttributes;
        }

        return undefined;
      },
      predecessors: () => [],
      successors: () => [],
    } as unknown as AdapterOperations;

    const context = buildContext(graph);
    EcsPlacementEnricher.indexNode?.({
      nodeId: taskDefinitionId,
      node: {} as TgNodeAttributes,
      values: {
        arn: 'arn:aws:ecs:eu-west-2:123456789012:task-definition/bridge:1',
        family: 'bridge',
        revision: 1,
      },
      context,
      resource: 'aws_ecs_task_definition',
      address: 'aws_ecs_task_definition.bridge',
      name: 'bridge',
    });

    const nonAwsvpcControls: { suppressPlacement?: boolean } = {};
    EcsPlacementEnricher.apply({
      nodeId: serviceId,
      node: {
        terraform: {
          resource: 'aws_ecs_service',
        },
      } as TgNodeAttributes,
      values: {
        task_definition: 'bridge:1',
        network_configuration: {
          subnet_ids: ['subnet-a'],
        },
      },
      context,
      subnetKeys: new Set<string>(),
      vpcKeys: new Set<string>(),
      explicitVpcId: undefined,
      controls: nonAwsvpcControls,
    });

    const missingControls: { suppressPlacement?: boolean } = {};
    EcsPlacementEnricher.apply({
      nodeId: serviceMissingId,
      node: {
        terraform: {
          resource: 'aws_ecs_service',
        },
      } as TgNodeAttributes,
      values: {
        task_definition: 'missing:1',
      },
      context,
      subnetKeys: new Set<string>(),
      vpcKeys: new Set<string>(),
      explicitVpcId: undefined,
      controls: missingControls,
    });

    expect(nonAwsvpcControls.suppressPlacement).toBe(true);
    expect(missingControls.suppressPlacement).toBe(true);
  });

  it('shoud ignore non-ecs resources entirely', () => {
    const controls: { suppressPlacement?: boolean } = {};
    const subnetKeys = new Set<string>();

    EcsPlacementEnricher.apply({
      nodeId: asNodeId('resource.aws_iam_role.app'),
      node: {
        terraform: {
          resource: 'aws_iam_role',
        },
      } as TgNodeAttributes,
      values: {},
      context: buildContext({
        getNodeAttributes: () => undefined,
        predecessors: () => [],
        successors: () => [],
      } as unknown as AdapterOperations),
      subnetKeys,
      vpcKeys: new Set<string>(),
      explicitVpcId: undefined,
      controls,
    });

    expect(subnetKeys).toStrictEqual(new Set<string>());
    expect(controls.suppressPlacement).toBeUndefined();
  });

  it('shoud suppress placement when no task definition ref or node attributes are available', () => {
    const unresolvedTaskDefinitionId = asNodeId('resource.aws_ecs_task_definition.missing');
    const serviceNoRefId = asNodeId('resource.aws_ecs_service.noref');
    const serviceMissingNodeId = asNodeId('resource.aws_ecs_service.missingnode');
    const graph = {
      getNodeAttributes: () => undefined,
      predecessors: (nodeId: string) =>
        nodeId === serviceMissingNodeId ? [unresolvedTaskDefinitionId] : [],
      successors: () => [],
    } as unknown as AdapterOperations;

    const context = buildContext(graph);
    context.groupNameToNodeId.set('ecs.task_definition', new Map([['missing:1', unresolvedTaskDefinitionId]]));

    const noRefControls: { suppressPlacement?: boolean } = {};
    EcsPlacementEnricher.apply({
      nodeId: serviceNoRefId,
      node: {
        terraform: {
          resource: 'aws_ecs_service',
        },
      } as TgNodeAttributes,
      values: {
        task_definition: 'missing:1',
      },
      context,
      subnetKeys: new Set<string>(),
      vpcKeys: new Set<string>(),
      explicitVpcId: undefined,
      controls: noRefControls,
    });

    const missingNodeControls: { suppressPlacement?: boolean } = {};
    EcsPlacementEnricher.apply({
      nodeId: serviceMissingNodeId,
      node: {
        terraform: {
          resource: 'aws_ecs_service',
        },
      } as TgNodeAttributes,
      values: {},
      context,
      subnetKeys: new Set<string>(),
      vpcKeys: new Set<string>(),
      explicitVpcId: undefined,
      controls: missingNodeControls,
    });

    expect(noRefControls.suppressPlacement).toBe(true);
    expect(missingNodeControls.suppressPlacement).toBe(true);
  });

  it('shoud resolve task definitions through neighboring nodes when explicit refs are absent', () => {
    const taskDefinitionId = asNodeId('resource.aws_ecs_task_definition.neighbor');
    const taskSetId = asNodeId('resource.aws_ecs_task_set.main');
    const graph = {
      getNodeAttributes: (nodeId: string) => {
        if (nodeId === taskDefinitionId) {
          return {
            terraform: {
              resource: 'aws_ecs_task_definition',
              state: {
                effective: {
                  values: {
                    network_mode: 'awsvpc',
                  },
                },
              },
            },
          } as TgNodeAttributes;
        }

        return undefined;
      },
      predecessors: (nodeId: string) => (nodeId === taskSetId ? [taskDefinitionId] : []),
      successors: () => [],
    } as unknown as AdapterOperations;

    const context = buildContext(graph);
    context.subnetIdentifierToKey.set('subnet-a', 'subnet-a');
    const controls: { suppressPlacement?: boolean } = {};
    const subnetKeys = new Set<string>();

    EcsPlacementEnricher.apply({
      nodeId: taskSetId,
      node: {
        terraform: {
          resource: 'aws_ecs_task_set',
        },
      } as TgNodeAttributes,
      values: {
        network_configuration: {
          subnets: ['subnet-a'],
        },
      },
      context,
      subnetKeys,
      vpcKeys: new Set<string>(),
      explicitVpcId: undefined,
      controls,
    });

    expect(subnetKeys).toStrictEqual(new Set<string>(['subnet-a']));
    expect(controls.suppressPlacement).toBeUndefined();
  });

  it('shoud derive ecs runtime subnets from neighboring load balancer graph paths when state lacks subnet ids', () => {
    const taskDefinitionId = asNodeId('resource.aws_ecs_task_definition.app');
    const serviceId = asNodeId('resource.aws_ecs_service.app');
    const listenerId = asNodeId('resource.aws_lb_listener.http');
    const loadBalancerId = asNodeId('resource.aws_lb.this');
    const subnetAId = asNodeId('resource.aws_subnet.public_a');
    const subnetBId = asNodeId('resource.aws_subnet.public_b');
    const graph = {
      getNodeAttributes: (nodeId: string) => {
        if (nodeId === taskDefinitionId) {
          return {
            terraform: {
              resource: 'aws_ecs_task_definition',
              state: {
                effective: {
                  values: {
                    network_mode: 'awsvpc',
                  },
                },
              },
            },
          } as TgNodeAttributes;
        }

        if (nodeId === loadBalancerId) {
          return {
            terraform: {
              resource: 'aws_lb',
            },
          } as TgNodeAttributes;
        }

        if (nodeId === listenerId) {
          return {
            terraform: {
              resource: 'aws_lb_listener',
            },
          } as TgNodeAttributes;
        }

        if (nodeId === subnetAId) {
          return {
            terraform: {
              resource: 'aws_subnet',
            },
          } as TgNodeAttributes;
        }

        if (nodeId === subnetBId) {
          return {
            terraform: {
              resource: 'aws_subnet',
            },
          } as TgNodeAttributes;
        }

        return undefined;
      },
      predecessors: (nodeId: string) => {
        if (nodeId === serviceId) {
          return [taskDefinitionId];
        }
        if (nodeId === listenerId) {
          return [serviceId];
        }
        if (nodeId === loadBalancerId) {
          return [listenerId];
        }
        if (nodeId === subnetAId || nodeId === subnetBId) {
          return [loadBalancerId];
        }

        return [];
      },
      successors: (nodeId: string) => {
        if (nodeId === serviceId) {
          return [listenerId];
        }
        if (nodeId === listenerId) {
          return [loadBalancerId];
        }
        if (nodeId === loadBalancerId) {
          return [subnetAId, subnetBId];
        }

        return [];
      },
    } as unknown as AdapterOperations;

    const context = buildContext(graph);
    context.subnetIdentifierToKey.set('subnet-a', 'subnet-a');
    context.subnetIdentifierToKey.set('subnet-b', 'subnet-b');
    context.subnetNodeToKey.set(subnetAId, 'subnet-a');
    context.subnetNodeToKey.set(subnetBId, 'subnet-b');

    const subnetKeys = new Set<string>();
    const controls: { suppressPlacement?: boolean } = {};

    EcsPlacementEnricher.apply({
      nodeId: serviceId,
      node: {
        terraform: {
          resource: 'aws_ecs_service',
        },
      } as TgNodeAttributes,
      values: {
        task_definition: 'app:1',
        network_configuration: {
          assign_public_ip: true,
        },
      },
      context,
      subnetKeys,
      vpcKeys: new Set<string>(),
      explicitVpcId: undefined,
      controls,
    });

    expect(subnetKeys).toStrictEqual(new Set<string>(['subnet-a', 'subnet-b']));
    expect(controls.suppressPlacement).toBeUndefined();
  });

  it('shoud reconcile ecs runtime placement from already-planned neighbor subnets', () => {
    const taskDefinitionId = asNodeId('resource.aws_ecs_task_definition.app');
    const serviceId = asNodeId('resource.aws_ecs_service.app');
    const securityGroupId = asNodeId('resource.aws_security_group.service');
    const graph = {
      getNodeAttributes: (nodeId: string) => {
        if (nodeId === taskDefinitionId) {
          return {
            terraform: {
              resource: 'aws_ecs_task_definition',
              state: {
                effective: {
                  values: {
                    network_mode: 'awsvpc',
                  },
                },
              },
            },
          } as TgNodeAttributes;
        }

        if (nodeId === securityGroupId) {
          return {
            terraform: {
              resource: 'aws_security_group',
            },
          } as TgNodeAttributes;
        }

        return undefined;
      },
      predecessors: (nodeId: string) => {
        if (nodeId === serviceId) {
          return [taskDefinitionId, securityGroupId];
        }

        return [];
      },
      successors: (nodeId: string) => {
        if (nodeId === serviceId) {
          return [securityGroupId];
        }

        return [];
      },
    } as unknown as AdapterOperations;

    const context = buildContext(graph);
    const subnetKeys = new Set<string>();
    const controls: { suppressPlacement?: boolean } = {};

    EcsPlacementEnricher.apply({
      nodeId: serviceId,
      node: {
        terraform: {
          resource: 'aws_ecs_service',
        },
      } as TgNodeAttributes,
      values: {
        task_definition: 'app:1',
        network_configuration: {
          assign_public_ip: true,
        },
      },
      context,
      subnetKeys,
      vpcKeys: new Set<string>(),
      explicitVpcId: undefined,
      controls,
    });

    EcsPlacementEnricher.reconcilePlacement?.({
      nodeId: serviceId,
      node: {
        terraform: {
          resource: 'aws_ecs_service',
        },
      } as TgNodeAttributes,
      values: {
        task_definition: 'app:1',
        network_configuration: {
          assign_public_ip: true,
        },
      },
      context,
      subnetKeys,
      vpcKeys: new Set<string>(),
      explicitVpcId: undefined,
      controls,
      plannedSubnetKeysByNodeId: new Map([[securityGroupId, ['subnet-a', 'subnet-b']]]),
    });

    expect(subnetKeys).toStrictEqual(new Set<string>(['subnet-a', 'subnet-b']));
    expect(controls.suppressPlacement).toBeUndefined();
  });
});
