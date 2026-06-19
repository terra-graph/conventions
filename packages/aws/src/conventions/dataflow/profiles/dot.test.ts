import {
  DotAdapter,
  NamedRuleRegistry,
  NamedRuleSetRegistry,
  NodeDotProperties,
  RemoveNode,
  RemoveNodeAndReconnectEdges,
} from '@terra-graph/core';
import createRuntimeProvider from '../../../index.js';
import { conventionName, profileName, ruleName, ruleSetName } from '../../../namespaces.js';
import { ApiGatewayPlugin } from '../../../plugins/ApiGatewayPlugin.js';
import { IamPlugin } from '../../../plugins/IamPlugin.js';
import { AwsNetworkPlacementPlugin } from '../../../plugins/Network/AwsNetworkPlacementPlugin.js';
import { VpcTopologyPlugin } from '../../../plugins/Network/VpcTopologyPlugin.js';
import { S3Plugin } from '../../../plugins/S3Plugin.js';
import { Convention } from '../../index.js';
import dataFlowConventionRules from '../rules.js';
import conventionDataFlowDotProfile, { conventionDataFlowDotProfileName } from './dot.js';

const baseNamedRules = new NamedRuleRegistry({
  'core.remove.tfconfig': new RemoveNodeAndReconnectEdges({
    node: {
      attr: {
        key: 'terraform.kind',
        in: ['local', 'var', 'terraform_data'],
      },
    },
  }),
  'core.remove.tfconfig_artifacts': new RemoveNode({
    node: {
      attr: {
        key: 'terraform.resource',
        in: ['null_resource', 'local_file'],
      },
    },
  }),
  'core.reconnect.time_sleep': new RemoveNodeAndReconnectEdges({
    node: {
      attr: {
        key: 'terraform.resource',
        eq: 'time_sleep',
      },
    },
  }),
  'core.materialize.cardinality_resources': new RemoveNode({
    node: {
      nodeId: {
        eq: '__never__',
      },
    },
  }),
  'core.collapse.indexed_resource_templates': new RemoveNodeAndReconnectEdges({
    node: {
      attr: {
        key: 'terraform.kind',
        eq: 'resource',
      },
    },
  }),
  'core.remove.childless_modules': new RemoveNode({
    node: {
      and: [{ attr: { key: 'terraform.kind', eq: 'module' } }, { children: { exists: false } }],
    },
  }),
  'core.remove.self_loops': new RemoveNode({
    node: {
      nodeId: {
        eq: '__never__',
      },
    },
  }),
  'dot.normalise_modules': new NodeDotProperties({
    options: {
      peripheries: 0,
      label: '',
      height: 0,
      width: 0,
    },
    node: {
      attr: {
        key: 'terraform.kind',
        eq: 'module',
      },
    },
  }),
});

const baseNamedRuleSets = new NamedRuleSetRegistry({});

describe('dataflow dot profile', () => {
  it('shoud expose namespaced profile metadata and plugin refs', () => {
    const serialized = conventionDataFlowDotProfile.serialize();

    expect(serialized.name).toBe(conventionDataFlowDotProfileName);
    expect(serialized.supports).toBe(DotAdapter.name);
    expect(serialized.phases?.map((phase) => phase.phase)).toStrictEqual(['final']);

    const baseProfile = serialized.usesProfiles?.[0];
    expect(baseProfile?.phases?.map((phase) => phase.phase)).toStrictEqual(['pre', 'main']);
    expect(baseProfile?.plugins).toEqual([
      { plugin: S3Plugin.id },
      {
        plugin: VpcTopologyPlugin.id,
        slot: 'topology',
      },
      {
        plugin: AwsNetworkPlacementPlugin.id,
        slot: 'topology-placement',
        options: {
          enrichers: ['ecs', 'efs', 'network'],
        },
      },
      {
        plugin: ApiGatewayPlugin.id,
        slot: 'apigateway',
        options: { mode: 'standard' },
      },
      {
        plugin: IamPlugin.id,
        slot: 'iam',
        options: { mode: 'full', removeOrphans: true },
      },
    ]);
    expect(conventionDataFlowDotProfileName).toBe(
      conventionName(Convention.DataFlow, profileName('dot')),
    );
  });

  it('shoud resolve phase plan with runtime provider registries', () => {
    const runtime = createRuntimeProvider();
    const runtimeNamedRules = runtime.namedRules;
    const runtimeNamedRuleSets = runtime.namedRuleSets;
    const runtimePlugins = runtime.plugins;

    if (!runtimeNamedRules || !runtimeNamedRuleSets || !runtimePlugins) {
      throw new Error('Runtime provider missing expected registries');
    }

    const namedRules = NamedRuleRegistry.from([baseNamedRules, runtimeNamedRules]);
    const namedRuleSets = NamedRuleSetRegistry.from([baseNamedRuleSets, runtimeNamedRuleSets]);
    const phases = conventionDataFlowDotProfile.resolvePhases(
      namedRules,
      namedRuleSets,
      runtimePlugins,
    );

    expect(phases.length).toBeGreaterThan(4);
    expect(
      phases.map((rules) => rules.some((rule) => rule.serialize().id === 'EdgeLegend')),
    ).toContain(true);
  });

  it('shoud reference conventions rules and rule sets from the dataflow profile', () => {
    const baseProfile = conventionDataFlowDotProfile.serialize().usesProfiles?.[0];
    const preRules = baseProfile?.phases?.[0]?.rules;
    const mainRules = conventionDataFlowDotProfile.serialize().phases?.[0]?.rules;

    expect(preRules).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'RemoveNode' })]),
    );
    expect(mainRules).toEqual(
      expect.arrayContaining([
        { namedRuleSet: ruleSetName('dot.sqs.dlq') },
        { namedRule: ruleName('dot.schedule.align') },
      ]),
    );
    expect(dataFlowConventionRules.names()).toEqual([]);
  });
});
