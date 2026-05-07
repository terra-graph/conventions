import {
  DeriveProjectionGraph,
  GraphPlugin,
  type GraphPluginBuildInput,
  type GraphPluginBuildResult,
} from '@terra-graph/core';
import { pluginId } from '../namespaces.js';

export type ProjectionPluginOptions = {
  strategies: unknown[];
};

export class ProjectionPlugin extends GraphPlugin<ProjectionPluginOptions> {
  static id = pluginId(ProjectionPlugin.name);

  constructor() {
    super(ProjectionPlugin.id, { strategies: [] });
  }

  public override build({
    options,
  }: GraphPluginBuildInput<ProjectionPluginOptions>): GraphPluginBuildResult {
    return {
      phases: [
        {
          phase: 'main',
          rules: [
            new DeriveProjectionGraph({
              node: { any: true },
              options,
            }),
          ],
        },
      ],
    };
  }
}
