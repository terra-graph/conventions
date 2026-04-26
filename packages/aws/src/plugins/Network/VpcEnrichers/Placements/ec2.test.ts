import { asNodeId, type AdapterOperations, type TgNodeAttributes } from '@terra-graph/core';
import { Ec2PlacementEnricher } from './ec2.js';
import type { PlacementContext } from '../types.js';

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

describe('Ec2PlacementEnricher', () => {
  it('shoud index security groups launch templates and launch configurations', () => {
    const context = buildContext({} as AdapterOperations);

    Ec2PlacementEnricher.indexNode?.({
      nodeId: asNodeId('resource.aws_security_group.app'),
      node: {
        terraform: { address: 'aws_security_group.app' },
      } as unknown as TgNodeAttributes,
      values: {
        id: 'sg-app',
      },
      context,
      resource: 'aws_security_group',
      address: 'aws_security_group.app',
      name: 'app',
    });

    Ec2PlacementEnricher.indexNode?.({
      nodeId: asNodeId('resource.aws_launch_template.app'),
      node: {
        terraform: { address: 'aws_launch_template.app' },
      } as unknown as TgNodeAttributes,
      values: {
        id: 'lt-123',
      },
      context,
      resource: 'aws_launch_template',
      address: 'aws_launch_template.app',
      name: 'app',
    });

    Ec2PlacementEnricher.indexNode?.({
      nodeId: asNodeId('resource.aws_launch_configuration.legacy'),
      node: {
        terraform: { address: 'aws_launch_configuration.legacy' },
      } as unknown as TgNodeAttributes,
      values: {
        id: 'lc-legacy',
      },
      context,
      resource: 'aws_launch_configuration',
      address: 'aws_launch_configuration.legacy',
      name: 'legacy',
    });

    Ec2PlacementEnricher.indexNode?.({
      nodeId: asNodeId('resource.aws_autoscaling_group.ignored'),
      node: {} as TgNodeAttributes,
      values: {},
      context,
      resource: 'aws_autoscaling_group',
      address: undefined,
      name: undefined,
    });

    expect(context.groupNameToNodeId.get('ec2.security_group')?.get('sg-app')).toBe(
      asNodeId('resource.aws_security_group.app'),
    );
    expect(context.groupNameToNodeId.get('ec2.launch_template')?.get('lt-123')).toBe(
      asNodeId('resource.aws_launch_template.app'),
    );
    expect(context.groupNameToNodeId.get('ec2.launch_configuration')?.get('lc-legacy')).toBe(
      asNodeId('resource.aws_launch_configuration.legacy'),
    );
  });

  it('shoud resolve ec2 placement metadata from security groups and launch references', () => {
    const securityGroupId = asNodeId('resource.aws_security_group.app');
    const launchTemplateId = asNodeId('resource.aws_launch_template.app');
    const launchConfigurationId = asNodeId('resource.aws_launch_configuration.legacy');
    const subnetNeighborNodeId = asNodeId('resource.aws_subnet.a');
    const vpcNeighborNodeId = asNodeId('resource.aws_vpc.main');

    const graph = {
      getNodeAttributes: (nodeId: string) => {
        if (nodeId === securityGroupId) {
          return {
            terraform: {
              state: {
                effective: {
                  values: {
                    vpc_id: 'vpc-1',
                  },
                },
              },
            },
          } as TgNodeAttributes;
        }

        if (nodeId === launchTemplateId) {
          return {
            terraform: {
              state: {
                effective: {
                  values: {
                    subnet_id: 'subnet-lt',
                  },
                },
              },
            },
          } as TgNodeAttributes;
        }

        if (nodeId === launchConfigurationId) {
          return {
            terraform: {
              state: {
                effective: {
                  values: {},
                },
              },
            },
          } as TgNodeAttributes;
        }

        return undefined;
      },
      predecessors: (nodeId: string) => (nodeId === launchTemplateId ? [subnetNeighborNodeId] : []),
      successors: (nodeId: string) => (nodeId === launchTemplateId ? [vpcNeighborNodeId] : []),
    } as unknown as AdapterOperations;

    const context = buildContext(graph);
    context.subnetNodeToKey.set(String(subnetNeighborNodeId), 'subnet-neighbor');
    context.vpcNodeToKey.set(String(vpcNeighborNodeId), 'vpc-neighbor');
    context.groupNameToNodeId.set('ec2.security_group', new Map([['sg-app', securityGroupId]]));
    context.groupNameToNodeId.set('ec2.launch_template', new Map([['lt-123', launchTemplateId]]));
    context.groupNameToNodeId.set(
      'ec2.launch_configuration',
      new Map([['lc-legacy', launchConfigurationId]]),
    );

    const subnetKeys = new Set<string>();
    const vpcKeys = new Set<string>();
    Ec2PlacementEnricher.apply({
      nodeId: asNodeId('resource.aws_autoscaling_group.app'),
      node: {
        terraform: {
          resource: 'aws_autoscaling_group',
        },
      } as TgNodeAttributes,
      values: {
        launch_template: [{ id: 'lt-123' }],
        launch_configuration: 'lc-legacy',
        vpc_security_group_ids: ['sg-app'],
        network_interfaces: [
          {
            subnet_id: 'subnet-direct',
            security_groups: ['sg-app'],
          },
        ],
      },
      context,
      subnetKeys,
      vpcKeys,
      explicitVpcId: undefined,
    });

    expect(subnetKeys).toStrictEqual(
      new Set<string>(['subnet-direct', 'subnet-lt', 'subnet-neighbor']),
    );
    expect(vpcKeys).toStrictEqual(new Set<string>(['vpc-1', 'vpc-neighbor']));
    expect(context.vpcIdentifierToKey.get('vpc-1')).toBe('vpc-1');
    expect(context.vpcs.get('vpc-1')).toStrictEqual({
      key: 'vpc-1',
      label: 'vpc-1',
    });
  });

  it('shoud resolve launch template names and tolerate missing identifiers', () => {
    const launchTemplateByNameId = asNodeId('resource.aws_launch_template.named');
    const graph = {
      getNodeAttributes: () => undefined,
      predecessors: () => [],
      successors: () => [],
    } as unknown as AdapterOperations;
    const context = buildContext(graph);
    context.groupNameToNodeId.set(
      'ec2.launch_template',
      new Map([['lt-name', launchTemplateByNameId]]),
    );

    const subnetKeys = new Set<string>();
    const vpcKeys = new Set<string>();
    Ec2PlacementEnricher.apply({
      nodeId: asNodeId('resource.aws_autoscaling_group.named'),
      node: {
        terraform: {
          resource: 'aws_autoscaling_group',
        },
      } as TgNodeAttributes,
      values: {
        launch_template: [{ name: 'lt-name' }],
      },
      context,
      subnetKeys,
      vpcKeys,
      explicitVpcId: undefined,
    });

    expect(subnetKeys.size).toBe(0);
    expect(vpcKeys.size).toBe(0);
  });

  it('shoud handle object blocks and unresolved group references', () => {
    const graph = {
      getNodeAttributes: () => undefined,
      predecessors: () => [],
      successors: () => [],
    } as unknown as AdapterOperations;
    const context = buildContext(graph);

    const subnetKeys = new Set<string>();
    const vpcKeys = new Set<string>();
    Ec2PlacementEnricher.apply({
      nodeId: asNodeId('resource.aws_autoscaling_group.object_blocks'),
      node: {
        terraform: {
          resource: 'aws_autoscaling_group',
        },
      } as TgNodeAttributes,
      values: {
        network_interface: {
          subnet_id: 'subnet-object',
          groups: ['sg-missing'],
        },
        launch_template: {
          id: 'lt-missing',
        },
        launch_configuration: 'lc-missing',
      },
      context,
      subnetKeys,
      vpcKeys,
      explicitVpcId: undefined,
    });

    expect(subnetKeys).toStrictEqual(new Set<string>(['subnet-object']));
    expect(vpcKeys.size).toBe(0);
  });
});
