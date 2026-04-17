import { conventionName, ruleSetName } from '../../namespaces.js';
import { Convention } from '../index.js';
import { AwsEdgeDirectionSemantics } from './edgeSemantics.js';
import dataFlowConventionRules from './rules.js';
import dataFlowConventionRuleSet from './rulesets.js';

describe('dataflow convention rule sets', () => {
  it('shoud register the dataflow semantics ruleset', () => {
    const names = dataFlowConventionRuleSet.names();
    expect(names).toHaveLength(2);
    expect(names).toEqual(
      expect.arrayContaining([
        conventionName(Convention.DataFlow, ruleSetName('cleanup')),
        conventionName(Convention.DataFlow, ruleSetName('semantics')),
      ]),
    );
  });

  it('shoud expand all semantic rules from the semantics rule set', () => {
    const ruleSet = dataFlowConventionRuleSet.resolve(
      conventionName(Convention.DataFlow, ruleSetName('semantics')),
    );
    const phases = ruleSet.resolvePhases(dataFlowConventionRules);
    const semanticValues = new Set<string>(Object.values(AwsEdgeDirectionSemantics));

    expect(phases).toHaveLength(1);
    const phaseRuleIds = phases[0].map((rule) => rule.serialize().id);
    expect(phaseRuleIds).toContain('EdgeSemanticLegend');
    expect(phaseRuleIds.filter((id) => id === 'EdgeDirectionSemantic').length).toBeGreaterThan(13);

    const directionSemanticValues = phases[0]
      .filter((rule) => rule.serialize().id === 'EdgeDirectionSemantic')
      .map(
        (rule) =>
          (
            rule.serialize().config as {
              options?: { semantic?: string };
            }
          ).options?.semantic,
      );
    expect(directionSemanticValues.length).toBeGreaterThan(13);
    for (const semantic of directionSemanticValues) {
      expect(semantic).toBeDefined();
      expect(semanticValues.has(semantic as string)).toBe(true);
    }

    const semanticLegendRule = phases[0].find(
      (rule) => rule.serialize().id === 'EdgeSemanticLegend',
    );
    expect(semanticLegendRule).toBeDefined();
    const legendBySemantic =
      (
        semanticLegendRule?.serialize().config as {
          options?: { legendBySemantic?: Record<string, unknown> };
        }
      ).options?.legendBySemantic ?? {};
    for (const semantic of Object.keys(legendBySemantic)) {
      expect(semanticValues.has(semantic)).toBe(true);
    }
  });
});
