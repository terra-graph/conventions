import dataFlowConventionRuleSet from './rulesets.js';
import dataFlowConventionRules from './rules.js';
import { Convention } from '../index.js';
import { conventionName, ruleSetName } from '../../namespaces.js';

describe('dataflow convention rule sets', () => {
  it('shoud register the dataflow semantics ruleset', () => {
    expect(dataFlowConventionRuleSet.names()).toEqual([
      conventionName(Convention.DataFlow, ruleSetName('semantics')),
    ]);
  });

  it('shoud expand all semantic rules from the semantics rule set', () => {
    const ruleSet = dataFlowConventionRuleSet.resolve(
      conventionName(Convention.DataFlow, ruleSetName('semantics')),
    );
    const phases = ruleSet.resolvePhases(dataFlowConventionRules);

    expect(phases).toHaveLength(1);
    const phaseRuleIds = phases[0].map((rule) => rule.serialize().id);
    expect(phaseRuleIds).toContain('EdgeSemanticLegend');
    expect(phaseRuleIds.filter((id) => id === 'EdgeDirectionSemantic')).toHaveLength(10);
  });
});
