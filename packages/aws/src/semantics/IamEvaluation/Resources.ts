import type { AdapterOperations, TgNodeAttributes } from '@terra-graph/core';
import type { SupportedTarget } from './AwsIamPermissionEvaluation.js';
import { AwsCloudwatchEventBusResolver } from './ResourceResolvers/AwsCloudwatchEventBusResolver.js';
import { AwsDynamoDbTableResolver } from './ResourceResolvers/AwsDynamoDbTableResolver.js';
import { AwsS3BucketResolver } from './ResourceResolvers/AwsS3BucketResolver.js';
import { AwsSfnStateMachineResolver } from './ResourceResolvers/AwsSfnStateMachineResolver.js';
import { AwsSqsQueueResolver } from './ResourceResolvers/AwsSqsQueueResolver.js';
import { DefaultResolver } from './ResourceResolvers/DefaultResolver.js';

export interface ResourceResolver {
  resolveSupportedTargetArns(
    node: TgNodeAttributes,
    valueCandidates: Record<string, unknown>[],
  ): string[];
  resolveTargetNames(valueCandidates: Record<string, unknown>[]): string[];
  resourceNamePatternFromArnPattern(resourcePattern: string): string | undefined;
  afterCollectSupportedTargets(targets: SupportedTarget[], graph: AdapterOperations): void;
}

const Resources: Record<string, ResourceResolver> = {
  aws_s3_bucket: new AwsS3BucketResolver(),
  aws_sqs_queue: new AwsSqsQueueResolver(),
  aws_cloudwatch_event_bus: new AwsCloudwatchEventBusResolver(),
  aws_sfn_state_machine: new AwsSfnStateMachineResolver(),
  aws_dynamodb_table: new AwsDynamoDbTableResolver(),
  standard: new DefaultResolver(),
};

export default Resources;
