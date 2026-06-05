import { AwsIamPermissionSemanticDecorator } from './AwsIamPermissionSemanticDecorator.js';
import { SemanticDecoratorRegistry } from '@terra-graph/core';
import { AwsPipeSemanticDecorator } from './AwsPipeSemanticDecorator.js';
import { AwsScheduleSemanticDecorator } from './AwsScheduleSemanticDecorator.js';

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
