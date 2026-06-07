import { SemanticDecoratorRegistry } from '@terra-graph/core';
import { AwsIamPermissionSemanticDecorator } from './AwsIamPermissionSemanticDecorator.js';
import { AwsPipeSemanticDecorator } from './AwsPipeSemanticDecorator.js';
import { AwsScheduleSemanticDecorator } from './AwsScheduleSemanticDecorator.js';
import { AwsSqsDeadLetterSemanticDecorator } from './AwsSqsDeadLetterSemanticDecorator.js';

SemanticDecoratorRegistry.register(
  AwsPipeSemanticDecorator.id,
  () => new AwsPipeSemanticDecorator(),
);

SemanticDecoratorRegistry.register(
  AwsScheduleSemanticDecorator.id,
  () => new AwsScheduleSemanticDecorator(),
);

SemanticDecoratorRegistry.register(
  AwsIamPermissionSemanticDecorator.id,
  (config) => new AwsIamPermissionSemanticDecorator(config),
);

SemanticDecoratorRegistry.register(
  AwsSqsDeadLetterSemanticDecorator.id,
  () => new AwsSqsDeadLetterSemanticDecorator(),
);
