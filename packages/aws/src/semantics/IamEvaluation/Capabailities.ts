import type { SupportedTarget } from './AwsIamPermissionEvaluation.js';

export type CapabilityDefinition = {
  capability: string;
  factKind: string;
  supportedTargetResourceTypes: string[];
  actionSamples: string[];
  shouldSkipResolveMatchedTargets(target: SupportedTarget): boolean;
};

const Capabilities: Record<string, CapabilityDefinition> = {
  s3_write: {
    capability: 's3_write',
    factKind: 'writes_to',
    supportedTargetResourceTypes: ['aws_s3_bucket'],
    actionSamples: ['s3:PutObject', 's3:PutObjectAcl', 's3:PutObjectTagging'],
    shouldSkipResolveMatchedTargets: () => false,
  },
  sqs_read: {
    capability: 'sqs_read',
    factKind: 'reads_from',
    supportedTargetResourceTypes: ['aws_sqs_queue'],
    actionSamples: ['sqs:ReceiveMessage'],
    shouldSkipResolveMatchedTargets: (target: SupportedTarget): boolean => {
      return (target.isDeadLetterQueue as boolean) ?? false;
    },
  },
  sqs_send: {
    capability: 'sqs_send',
    factKind: 'publishes_to',
    supportedTargetResourceTypes: ['aws_sqs_queue'],
    actionSamples: ['sqs:SendMessage'],
    shouldSkipResolveMatchedTargets: (target: SupportedTarget): boolean => {
      return (target.isDeadLetterQueue as boolean) ?? false;
    },
  },
  eventbridge_put: {
    capability: 'eventbridge_put',
    factKind: 'publishes_to',
    supportedTargetResourceTypes: ['aws_cloudwatch_event_bus'],
    actionSamples: ['events:PutEvents'],
    shouldSkipResolveMatchedTargets: () => false,
  },
};

export const AWS_IAM_PERMISSION_CAPABILITIES = (): string[] =>
  Object.values(Capabilities).map((def) => def.capability);

export default Capabilities;
