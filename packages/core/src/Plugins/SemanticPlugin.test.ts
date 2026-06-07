import { GraphPluginRegistry, Profile, type SemanticDecorator } from '@terra-graph/core';
import { SemanticPlugin } from './SemanticPlugin.js';

describe('SemanticPlugin', () => {
  it('should contribute a main-phase semantic extraction rule when decorators are configured', () => {
    const registry = new GraphPluginRegistry({
      [SemanticPlugin.id]: new SemanticPlugin(),
    });
    const decorator: SemanticDecorator = {
      name: 'test.semantic.decorator',
      extract: ({ graph }) => graph,
      project: ({ graph }) => graph,
    };
    const profile = new Profile('semantic', {
      plugins: [
        {
          plugin: SemanticPlugin.id,
          options: {
            decorators: [decorator],
          },
        },
      ],
    });

    const phases = profile.resolvePhases(undefined, undefined, registry);

    expect(phases).toHaveLength(1);
    expect(phases[0][0]?.serialize()).toEqual({
      id: 'ApplySemanticDecorators',
      config: {
        node: { any: true },
      },
    });
  });
});
