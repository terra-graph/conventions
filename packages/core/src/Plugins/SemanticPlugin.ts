import {
  ApplySemanticDecorators,
  GraphPlugin,
  type GraphPluginBuildInput,
  type GraphPluginBuildResult,
  type SemanticDecoratorDefinition,
  resolveSemanticDecorators,
} from '@terra-graph/core';
import { pluginId } from '../namespaces.js';

export type SemanticPluginOptions = {
  decorators?: SemanticDecoratorDefinition[];
};

export class SemanticPlugin extends GraphPlugin<SemanticPluginOptions> {
  static id = pluginId(SemanticPlugin.name);

  constructor() {
    super(SemanticPlugin.id, {
      decorators: [],
    });
  }

  public override build({
    options,
  }: GraphPluginBuildInput<SemanticPluginOptions>): GraphPluginBuildResult {
    const decorators = resolveSemanticDecorators(options.decorators);
    if (decorators.length === 0) {
      return {};
    }

    return {
      phases: [
        {
          phase: 'main',
          rules: [
            new ApplySemanticDecorators({
              options: {
                mode: 'extract',
                decorators,
              },
            }),
          ],
        },
      ],
    };
  }
}
