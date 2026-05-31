import { DefaultEdgeSemantics, DotAdapter } from '@terra-graph/core';
import { conventionDataFlowBaseProfileName } from './conventions/dataflow/profiles/base.js';
import { conventionDataFlowDotProfileName } from './conventions/dataflow/profiles/dot.js';
import dataFlowConventionRules from './conventions/dataflow/rules.js';
import { Convention } from './conventions/index.js';
import buildRuntimeProvider, { AwsEdgeSemantics } from './index.js';
import { conventionName, ruleName, ruleSetName } from './namespaces.js';
import { ApiGatewayPlugin } from './plugins/ApiGatewayPlugin.js';
import { IamPlugin } from './plugins/IamPlugin.js';
import { AwsNetworkPlacementPlugin } from './plugins/Network/AwsNetworkPlacementPlugin.js';
import { VpcTopologyPlugin } from './plugins/Network/VpcTopologyPlugin.js';
import { S3Plugin } from './plugins/S3Plugin.js';
import { SnsPlugin } from './plugins/SnsPlugin.js';

const assertRuntime = (runtime: ReturnType<typeof buildRuntimeProvider>) => {
  const { supportedAdapterOperationsRegistry, plugins, namedRules, namedRuleSets, profiles } =
    runtime;
  if (
    !supportedAdapterOperationsRegistry ||
    !plugins ||
    !namedRules ||
    !namedRuleSets ||
    !profiles
  ) {
    throw new Error('Runtime provider missing expected registries');
  }
  return {
    supportedAdapterOperationsRegistry,
    plugins,
    namedRules,
    namedRuleSets,
    profiles,
  };
};

describe('aws provider', () => {
  it('shoud expose a complete runtime provider with all registrations', () => {
    const runtime = buildRuntimeProvider();
    const { supportedAdapterOperationsRegistry, plugins, namedRules, namedRuleSets, profiles } =
      assertRuntime(runtime);

    expect(supportedAdapterOperationsRegistry.DotAdapter).toBe(DotAdapter);
    expect(plugins.names().sort()).toStrictEqual(
      [
        ApiGatewayPlugin.id,
        AwsNetworkPlacementPlugin.id,
        VpcTopologyPlugin.id,
        IamPlugin.id,
        S3Plugin.id,
        SnsPlugin.id,
      ].sort(),
    );
    expect(namedRules.names().sort()).toEqual(
      [
        ruleName('data.remove'),
        ruleName('dot.sqs.dlq.align'),
        ruleName('dot.schedule.align'),
        ruleName('dot.iam_role.align'),
        ...dataFlowConventionRules.names(),
      ].sort(),
    );
    expect(namedRuleSets.names().sort()).toEqual(
      [
        ruleSetName('dot.sqs.dlq'),
        conventionName(Convention.DataFlow, ruleSetName('pre')),
        conventionName(Convention.DataFlow, ruleSetName('main')),
        conventionName(Convention.DataFlow, ruleSetName('final')),
      ].sort(),
    );
    expect(profiles.names().sort()).toEqual(
      [conventionDataFlowBaseProfileName, conventionDataFlowDotProfileName].sort(),
    );
  });

  it('shoud aggregate rule registries without losing named registration count', () => {
    const runtime = buildRuntimeProvider();
    const { namedRules, namedRuleSets, profiles } = assertRuntime(runtime);
    expect(namedRules.names().length).toBe(4);
    expect(namedRuleSets.names().length).toBe(4);
    expect(profiles.names().length).toBe(2);
  });

  it('shoud export aws edge direction semantic names', () => {
    expect(AwsEdgeSemantics).toEqual(DefaultEdgeSemantics);
    expect(AwsEdgeSemantics.Authorizes.role).toBe('supporting');
    expect(AwsEdgeSemantics.Accesses.role).toBe('primary');
    expect(AwsEdgeSemantics.ObservedBy.role).toBe('supporting');
  });
});
