import type { SupportedTarget } from './AwsIamPermissionEvaluation.js';

export const CapabilityFactDirections = {
  SubjectToTarget: 'subject_to_target',
  TargetToSubject: 'target_to_subject',
} as const;

export type CapabilityFactDirection =
  (typeof CapabilityFactDirections)[keyof typeof CapabilityFactDirections];

export type CapabilityDefinition = {
  capability: string;
  factKind: string;
  direction: CapabilityFactDirection;
  supportedTargetResourceTypes: string[];
  actionSamples: string[];
  shouldSkipResolveMatchedTargets(target: SupportedTarget): boolean;
};

const Capabilities: Record<string, CapabilityDefinition> = {
  s3_write: {
    capability: 's3_write',
    factKind: 'writes_to',
    direction: CapabilityFactDirections.SubjectToTarget,
    supportedTargetResourceTypes: ['aws_s3_bucket'],
    actionSamples: ['s3:PutObject', 's3:CopyObject', 's3:PutObjectAcl', 's3:PutObjectTagging'],
    shouldSkipResolveMatchedTargets: () => false,
  },
  s3_read: {
    capability: 's3_read',
    factKind: 'reads_from',
    direction: CapabilityFactDirections.SubjectToTarget,
    supportedTargetResourceTypes: ['aws_s3_bucket'],
    actionSamples: ['s3:GetObject'],
    shouldSkipResolveMatchedTargets: () => false,
  },
  sqs_read: {
    capability: 'sqs_read',
    factKind: 'reads_from',
    direction: CapabilityFactDirections.TargetToSubject,
    supportedTargetResourceTypes: ['aws_sqs_queue'],
    actionSamples: ['sqs:ReceiveMessage'],
    shouldSkipResolveMatchedTargets: (target: SupportedTarget): boolean => {
      return (target.isDeadLetterQueue as boolean) ?? false;
    },
  },
  sqs_send: {
    capability: 'sqs_send',
    factKind: 'publishes_to',
    direction: CapabilityFactDirections.SubjectToTarget,
    supportedTargetResourceTypes: ['aws_sqs_queue'],
    actionSamples: ['sqs:SendMessage'],
    shouldSkipResolveMatchedTargets: (target: SupportedTarget): boolean => {
      return (target.isDeadLetterQueue as boolean) ?? false;
    },
  },
  eventbridge_put: {
    capability: 'eventbridge_put',
    factKind: 'publishes_to',
    direction: CapabilityFactDirections.SubjectToTarget,
    supportedTargetResourceTypes: ['aws_cloudwatch_event_bus'],
    actionSamples: ['events:PutEvents'],
    shouldSkipResolveMatchedTargets: () => false,
  },
  dynamodb_write: {
    capability: 'dynamodb_write',
    factKind: 'writes_to',
    direction: CapabilityFactDirections.SubjectToTarget,
    supportedTargetResourceTypes: ['aws_dynamodb_table'],
    actionSamples: ['dynamodb:UpdateItem', 'dynamodb:PutItem'],
    shouldSkipResolveMatchedTargets: () => false,
  },
  dynamodb_read: {
    capability: 'dynamodb_read',
    factKind: 'reads_from',
    direction: CapabilityFactDirections.SubjectToTarget,
    supportedTargetResourceTypes: ['aws_dynamodb_table'],
    actionSamples: ['dynamodb:GetItem'],
    shouldSkipResolveMatchedTargets: () => false,
  },
};

export const AWS_IAM_PERMISSION_CAPABILITIES = (): string[] =>
  Object.values(Capabilities).map((def) => def.capability);

export default Capabilities;
