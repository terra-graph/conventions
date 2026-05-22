import { NamedRuleSetRegistry, RemoveNode, RuleSet } from '@terra-graph/core';
import { conventionName, ruleSetName } from '../../namespaces.js';
import { Convention } from '../index.js';
import acmSemanticsRuleSet from './rulesets/acm.js';
import albSemanticsRuleSet, { albCleanupRuleSet } from './rulesets/alb.js';
import apiGatewaySemanticsRuleSet from './rulesets/apigateway.js';
import athenaSemanticsRuleSet from './rulesets/athena.js';
import cloudFrontSemanticsRuleSet from './rulesets/cloudfront.js';
import cloudwatchSemanticsRuleSet from './rulesets/cloudwatch.js';
import dynamodbSemanticsRuleSet from './rulesets/dynamodb.js';
import ec2CleanupRuleSet from './rulesets/ec2.js';
import ecsSemanticsRuleSet, { ecsCleanupRuleSet } from './rulesets/ecs.js';
import eventBridgeSemanticsRuleSet from './rulesets/eventbridge.js';
import glueSemanticsRuleSet from './rulesets/glue.js';
import iamSemanticsRuleSet from './rulesets/iam.js';
import kinesisSemanticsRuleSet from './rulesets/kinesis.js';
import lambdaSemanticsRuleSet, { lambdaPreRuleSet } from './rulesets/lambda.js';
import legendSemanticsRuleSet from './rulesets/legend.js';
import networkSemanticsRuleSet from './rulesets/network.js';
import s3SemanticsRuleSet from './rulesets/s3.js';
import schedulerSemanticsRuleSet from './rulesets/scheduler.js';
import secretsManagerSemanticsRuleSet from './rulesets/secretsmanager.js';
import snsSemanticsRuleSet from './rulesets/sns.js';
import sqsSemanticsRuleSet from './rulesets/sqs.js';
import stepFunctionsSemanticsRuleSet from './rulesets/stepfunctions.js';
import timestreamSemanticsRuleSet from './rulesets/timestream.js';
import wafSemanticsRuleSet from './rulesets/waf.js';

const flattenRules = (ruleSets: RuleSet[]) =>
  ruleSets.flatMap((ruleSet) => ruleSet.resolvePhases()[0] ?? []);

export default new NamedRuleSetRegistry({
  [conventionName(Convention.DataFlow, ruleSetName('pre'))]: new RuleSet({
    rules: flattenRules([lambdaPreRuleSet]),
  }),
  [conventionName(Convention.DataFlow, ruleSetName('main'))]: new RuleSet({
    rules: [
      ...flattenRules([
        iamSemanticsRuleSet,
        lambdaSemanticsRuleSet,
        cloudwatchSemanticsRuleSet,
        eventBridgeSemanticsRuleSet,
        dynamodbSemanticsRuleSet,
        schedulerSemanticsRuleSet,
        s3SemanticsRuleSet,
        ecsSemanticsRuleSet,
        networkSemanticsRuleSet,
        stepFunctionsSemanticsRuleSet,
        secretsManagerSemanticsRuleSet,
        athenaSemanticsRuleSet,
        sqsSemanticsRuleSet,
        snsSemanticsRuleSet,
        kinesisSemanticsRuleSet,
        albSemanticsRuleSet,
        apiGatewaySemanticsRuleSet,
        glueSemanticsRuleSet,
        timestreamSemanticsRuleSet,
        wafSemanticsRuleSet,
        acmSemanticsRuleSet,
        cloudFrontSemanticsRuleSet,
      ]),
      ...flattenRules([albCleanupRuleSet, ec2CleanupRuleSet, ecsCleanupRuleSet]),
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
