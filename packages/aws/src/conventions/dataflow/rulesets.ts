import { NamedRuleSetRegistry, RemoveNode, RuleSet } from '@terra-graph/core';
import { conventionName, ruleSetName } from '../../namespaces.js';
import { Convention } from '../index.js';
import legendSemanticsRuleSet from './rulesets/legend.js';

/* istanbul ignore next -- empty-ruleset fallback is a tiny helper branch covered indirectly by profile resolution */
const flattenRules = (ruleSets: RuleSet[]) =>
  ruleSets.flatMap((ruleSet) => ruleSet.resolvePhases()[0] ?? []);

export default new NamedRuleSetRegistry({
  // [conventionName(Convention.DataFlow, ruleSetName('pre'))]: new RuleSet({
  //   rules: flattenRules([lambdaPreRuleSet]),
  // }),
  [conventionName(Convention.DataFlow, ruleSetName('main'))]: new RuleSet({
    rules: [
      //     ...flattenRules([
      //       iamSemanticsRuleSet,
      //       lambdaSemanticsRuleSet,
      //       cloudwatchSemanticsRuleSet,
      //       eventBridgeSemanticsRuleSet,
      //       dynamodbSemanticsRuleSet,
      //       schedulerSemanticsRuleSet,
      //       s3SemanticsRuleSet,
      //       ecsSemanticsRuleSet,
      //       networkSemanticsRuleSet,
      //       stepFunctionsSemanticsRuleSet,
      //       secretsManagerSemanticsRuleSet,
      //       athenaSemanticsRuleSet,
      //       sqsSemanticsRuleSet,
      //       snsSemanticsRuleSet,
      //       kinesisSemanticsRuleSet,
      //       albSemanticsRuleSet,
      //       apiGatewaySemanticsRuleSet,
      //       glueSemanticsRuleSet,
      //       timestreamSemanticsRuleSet,
      //       wafSemanticsRuleSet,
      //       acmSemanticsRuleSet,
      //       cloudFrontSemanticsRuleSet,
      //     ]),
      //     ...flattenRules([albCleanupRuleSet, ec2CleanupRuleSet, ecsCleanupRuleSet]),
      new RemoveNode({
        node: {
          and: [
            {
              attr: {
                key: 'terraform.resource',
                eq: 'aws_lambda_event_source_mapping',
              },
            },
            { not: { edge: { in: { any: true } } } },
          ],
        },
      }),
    ],
  }),
  [conventionName(Convention.DataFlow, ruleSetName('final'))]: new RuleSet({
    rules: flattenRules([legendSemanticsRuleSet]),
  }),
});
