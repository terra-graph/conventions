import { profileName } from './namespaces.js';
import { coreBase } from './profiles.js';

describe('coreBase profile', () => {
  it('should expose a namespaced base profile with expected phases', () => {
    const serialized = coreBase.serialize();

    expect(serialized.name).toBe(profileName('base'));
    expect(serialized.phases?.map((phase) => phase.phase)).toStrictEqual(['pre']);
    expect(serialized.phases?.[0]?.rules).toEqual([
      { namedRule: 'core.remove.tfconfig' },
      { namedRule: 'core.reconnect.time_sleep' },
      { namedRule: 'core.remove.childless_modules' },
    ]);
  });
});
