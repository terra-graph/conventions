import { SemanticDecoratorRegistry } from '@terra-graph/core';
import { AwsIamPermissionSemanticDecorator } from './AwsIamPermissionSemanticDecorator.js';
import { AwsPipeSemanticDecorator } from './AwsPipeSemanticDecorator.js';
import { AwsScheduleSemanticDecorator } from './AwsScheduleSemanticDecorator.js';
import { AwsSqsDeadLetterSemanticDecorator } from './AwsSqsDeadLetterSemanticDecorator.js';
import './registerAll.js';

describe('semantics registerAll', () => {
  it('should register all AWS semantic decorators', () => {
    expect(SemanticDecoratorRegistry.resolve({ id: AwsPipeSemanticDecorator.id })).toBeInstanceOf(
      AwsPipeSemanticDecorator,
    );
    expect(
      SemanticDecoratorRegistry.resolve({ id: AwsScheduleSemanticDecorator.id }),
    ).toBeInstanceOf(AwsScheduleSemanticDecorator);
    expect(
      SemanticDecoratorRegistry.resolve({
        id: AwsIamPermissionSemanticDecorator.id,
        config: { subjects: [{ resourceTypes: ['aws_lambda_function'] }] },
      }),
    ).toBeInstanceOf(AwsIamPermissionSemanticDecorator);
    expect(
      SemanticDecoratorRegistry.resolve({ id: AwsSqsDeadLetterSemanticDecorator.id }),
    ).toBeInstanceOf(AwsSqsDeadLetterSemanticDecorator);
  });
});
