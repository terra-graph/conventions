import {
  GraphPlugin,
  type GraphPluginBuildInput,
  type GraphPluginBuildResult,
} from '@terra-graph/core';
import { pluginId } from '../namespaces.js';
import { ProjectionPipelineBuilder } from './ProjectionPipelineBuilder.js';
import type { ProjectionPluginOptions } from './ProjectionPluginOptions.js';

export class ProjectionPlugin extends GraphPlugin<ProjectionPluginOptions> {
  static id = pluginId(ProjectionPlugin.name);

  private readonly pipelineBuilder = new ProjectionPipelineBuilder();

  constructor() {
    super(ProjectionPlugin.id, {
      projections: [],
      adjacencyRelationships: [],
      semanticRelationships: [],
      semanticDecorators: [],
      instanceStrategy: 'none',
    });
  }

  public override build({
    options,
  }: GraphPluginBuildInput<ProjectionPluginOptions>): GraphPluginBuildResult {
    return {
      phases: this.pipelineBuilder.build(options),
    };
  }
}
