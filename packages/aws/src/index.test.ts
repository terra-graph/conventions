import { DotAdapter } from '@terra-graph/core';
import { AwsApiGateway } from './plugins/AwsApiGateway.js';
import { AwsIamGraphPlugin } from './plugins/AwsIam.js';
import { AwsS3 } from './plugins/AwsS3.js';
import { AwsSns } from './plugins/AwsSns.js';
import { AwsTransferFamily } from './plugins/AwsTransferFamily.js';
import { conventionDataFlowDotProfileName } from './conventions/dataflow/profiles/dot.js';
import dataFlowConventionRules from './conventions/dataflow/rules.js';
import dataflowConventionRuleSet from './conventions/dataflow/rulesets.js';
import { conventionName, ruleName, ruleSetName } from './namespaces.js';
import { Convention } from './conventions/index.js';
import buildRuntimeProvider from './index.js';

const assertRuntime = (runtime: ReturnType<typeof buildRuntimeProvider>) => {
  const { supportedAdapterOperationsRegistry, plugins, namedRules, namedRuleSets, profiles } = runtime;
  if (!supportedAdapterOperationsRegistry || !plugins || !namedRules || !namedRuleSets || !profiles) {
    throw new Error('Runtime provider missing expected registries');
  }
  return { supportedAdapterOperationsRegistry, plugins, namedRules, namedRuleSets, profiles };
};

describe('aws provider', () => {
  it('shoud expose a complete runtime provider with all registrations', () => {
    const runtime = buildRuntimeProvider();
    const { supportedAdapterOperationsRegistry, plugins, namedRules, namedRuleSets, profiles } = assertRuntime(runtime);

    expect(supportedAdapterOperationsRegistry.DotAdapter).toBe(DotAdapter);
    expect(plugins.names().sort()).toStrictEqual(
      [
        AwsApiGateway.id,
        AwsIamGraphPlugin.id,
        AwsS3.id,
        AwsSns.id,
        AwsTransferFamily.id,
      ].sort(),
    );
    expect(namedRules.names().sort()).toEqual(
      [
        ruleName('data.remove'),
        ruleName('log_groups.only_event_bridge'),
        ruleName('lambda.only_event_source_mapping'),
        ruleName('dot.sqs.dlq.align'),
        ruleName('dot.schedule.align'),
        ruleName('dot.iam_role.align'),
        ...dataFlowConventionRules.names(),
      ].sort(),
    );
    expect(namedRuleSets.names().sort()).toEqual(
      [
        ruleSetName('dot.sqs.dlq'),
        conventionName(Convention.DataFlow, ruleSetName('semantics')),
      ].sort(),
    );
    expect(profiles.names()).toEqual([conventionDataFlowDotProfileName]);
  });

  it('shoud aggregate rule registries without losing named registration count', () => {
    const runtime = buildRuntimeProvider();
    const { namedRules, namedRuleSets, profiles } = assertRuntime(runtime);
    expect(namedRules.names().length).toBe(6);
    expect(namedRuleSets.names().length).toBe(2);
    expect(profiles.names().length).toBe(1);
  });
});
