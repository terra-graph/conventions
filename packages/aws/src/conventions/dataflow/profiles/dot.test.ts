import {
  NamedRuleRegistry,
  NamedRuleSetRegistry,
  defaultRuntimeProvider,
  DotAdapter,
} from 'terra-graph';
import { AwsIamGraphPlugin } from '../../../plugins/AwsIam.js';
import { AwsS3 } from '../../../plugins/AwsS3.js';
import conventionDataFlowDotProfile, {
  conventionDataFlowDotProfileName,
} from './dot.js';
import dataFlowConventionRuleSet from '../rulesets.js';
import dataFlowConventionRules from '../rules.js';
import createRuntimeProvider from '../../../index.js';
import { conventionName, profileName, ruleName, ruleSetName } from '../../../namespaces.js';
import { Convention } from '../../index.js';

describe('dataflow dot profile', () => {
  it('shoud expose namespaced profile metadata and plugin refs', () => {
    const serialized = conventionDataFlowDotProfile.serialize();

    expect(serialized.name).toBe(conventionDataFlowDotProfileName);
    expect(serialized.supports).toBe(DotAdapter.name);
    expect(serialized.phases?.map((phase) => phase.phase)).toStrictEqual([
      'pre',
      'main',
      'semantics',
      'main',
    ]);
    expect(serialized.plugins).toEqual([
      { plugin: AwsS3.id },
      {
        plugin: AwsIamGraphPlugin.id,
        options: { mode: 'full', removeOrphans: true },
      },
    ]);
    expect(conventionDataFlowDotProfileName).toBe(
      conventionName(Convention.DataFlow, profileName('dot')),
    );
  });

  it('shoud resolve phase plan with runtime provider registries', () => {
    const runtime = createRuntimeProvider();
    const namedRules = NamedRuleRegistry.from([
      defaultRuntimeProvider.namedRules,
      runtime.namedRules,
    ]);
    const namedRuleSets = NamedRuleSetRegistry.from([
      defaultRuntimeProvider.namedRuleSets,
      runtime.namedRuleSets,
    ]);
    const phases = conventionDataFlowDotProfile.resolvePhases(
      namedRules,
      namedRuleSets,
      runtime.plugins,
    );

    expect(phases.length).toBeGreaterThan(4);
    expect(
      phases.map((rules) => rules.some((rule) => rule.serialize().id === 'EdgeLegend')),
    ).toContain(true);
    expect(
      phases.map((rules) => rules.some((rule) => rule.serialize().id === 'ConvertNodeToEdge')),
    ).toContain(true);
  });

  it('shoud reference conventions rules and rule sets from the dataflow profile', () => {
    const preRules = conventionDataFlowDotProfile.serialize().phases?.[0]?.rules;
    const mainRules = conventionDataFlowDotProfile.serialize().phases?.[1]?.rules;

    expect(preRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'RemoveNode' }),
        { namedRule: ruleName('lambda.only_event_source_mapping') },
      ]),
    );
    expect(mainRules).toEqual(
      expect.arrayContaining([
        { namedRuleSet: ruleSetName('dot.sqs.dlq') },
        { namedRule: ruleName('dot.schedule.align') },
      ]),
    );
    expect(dataFlowConventionRuleSet.names()).toContain(
      conventionName(Convention.DataFlow, ruleSetName('semantics')),
    );
    expect(dataFlowConventionRules.names()).toContain(
      conventionName(Convention.DataFlow, ruleName('triggers.async_sources_to_consumers')),
    );
  });
});
