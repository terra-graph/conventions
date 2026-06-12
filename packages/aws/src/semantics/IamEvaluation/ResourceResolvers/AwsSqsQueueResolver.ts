import {
  type AdapterOperations,
  type NodeId,
  isArrayOfUnknown,
  isObjectRecord,
  normalizeTerraformAddress,
  resolveNodeReference,
} from '@terra-graph/core';
import {
  collectTerraformStateValueCandidates,
  parseJsonArrayOfStrings,
  parseJsonObject,
} from '../../../utils.js';
import type { SupportedTarget } from '../AwsIamPermissionEvaluation.js';
import { DefaultResolver } from './DefaultResolver.js';

export class AwsSqsQueueResolver extends DefaultResolver {
  public override resourceNamePatternFromArnPattern(resourcePattern: string): string | undefined {
    const match = resourcePattern.match(/^arn:[^:]*:sqs:[^:]*:[^:]*:(.+)$/);
    return match?.[1];
  }

  public override afterCollectSupportedTargets(
    targets: SupportedTarget[],
    graph: AdapterOperations,
  ) {
    const sqsTargets = targets.filter((target) => target.resourceType === 'aws_sqs_queue');
    const sqsTargetByArn = new Map<string, SupportedTarget>();
    const sqsTargetByName = new Map<string, SupportedTarget>();
    const sqsNodeIdByAddress = new Map<string, NodeId>();

    for (const target of sqsTargets) {
      for (const arn of target.arns) {
        sqsTargetByArn.set(arn, target);
      }
      for (const name of target.names) {
        sqsTargetByName.set(name, target);
      }
      const address = graph.getNodeAttributes(target.nodeId)?.terraform?.address;
      if (address) {
        sqsNodeIdByAddress.set(address, target.nodeId);
        sqsNodeIdByAddress.set(normalizeTerraformAddress(address), target.nodeId);
      }
    }

    // this loop basically assigns isDeadLetterQueue=true to any nodes it evaluates as sqs dead letter queues
    for (const nodeId of graph.nodeIds()) {
      const node = graph.getNodeAttributes(nodeId);
      if (!node || node?.terraform?.resource !== 'aws_sqs_queue') {
        continue;
      }

      for (const values of collectTerraformStateValueCandidates(node)) {
        const rawRedrivePolicy = values.redrive_policy;
        const redrivePolicy =
          typeof rawRedrivePolicy === 'string'
            ? parseJsonObject(rawRedrivePolicy)
            : isObjectRecord(rawRedrivePolicy)
              ? rawRedrivePolicy
              : undefined;
        const deadLetterTargetArn =
          typeof redrivePolicy?.deadLetterTargetArn === 'string'
            ? redrivePolicy.deadLetterTargetArn
            : undefined;

        if (deadLetterTargetArn) {
          const exactTarget = sqsTargetByArn.get(deadLetterTargetArn);
          const deadLetterQueueName = this.queueNameFromSqsArn(deadLetterTargetArn);
          const namedTarget = deadLetterQueueName
            ? sqsTargetByName.get(deadLetterQueueName)
            : undefined;
          const target = exactTarget ?? namedTarget;

          if (target) {
            target.isDeadLetterQueue = true;
          }
        }

        const rawRedriveAllowPolicy = values.redrive_allow_policy;
        const redriveAllowPolicy =
          typeof rawRedriveAllowPolicy === 'string'
            ? parseJsonObject(rawRedriveAllowPolicy)
            : isObjectRecord(rawRedriveAllowPolicy)
              ? rawRedriveAllowPolicy
              : undefined;
        const sourceQueueArns = parseJsonArrayOfStrings(redriveAllowPolicy?.sourceQueueArns);

        if (sourceQueueArns.length > 0) {
          const currentTarget = sqsTargets.find((target) => target.nodeId === nodeId);
          if (currentTarget) {
            currentTarget.isDeadLetterQueue = true;
          }
        }

        const redrivePolicyReference = (() => {
          const expressions = node.terraform?.configuration?.expressions;
          if (!isObjectRecord(expressions)) {
            return undefined;
          }

          const expression = expressions.redrive_policy;
          if (!isObjectRecord(expression) || !isArrayOfUnknown(expression.references)) {
            return undefined;
          }

          return expression.references.find(
            (reference): reference is string =>
              typeof reference === 'string' &&
              resolveNodeReference(reference, sqsNodeIdByAddress) !== undefined,
          );
        })();

        if (redrivePolicyReference) {
          const resolvedTargetNodeId = resolveNodeReference(
            redrivePolicyReference,
            sqsNodeIdByAddress,
          );
          /* istanbul ignore next -- target lookup can race only in malformed mocked graphs */
          const resolvedTarget = resolvedTargetNodeId
            ? /* istanbul ignore next -- malformed mocked graphs can lose the resolved target after reference resolution */
              sqsTargets.find((target) => target.nodeId === resolvedTargetNodeId)
            : undefined;
          if (resolvedTarget) {
            resolvedTarget.isDeadLetterQueue = true;
          }
        }
      }
    }
  }

  private queueNameFromSqsArn(arn: string): string | undefined {
    const match = arn.match(/^arn:[^:]*:sqs:[^:]*:[^:]*:(.+)$/);
    return match?.[1];
  }
}
