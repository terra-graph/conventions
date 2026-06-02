import { SemanticDecoratorRegistry } from '@terra-graph/core';
import { AwsPipeSemanticDecorator } from './AwsPipeSemanticDecorator.js';

SemanticDecoratorRegistry.register(
  AwsPipeSemanticDecorator.id,
  () => new AwsPipeSemanticDecorator(),
);
