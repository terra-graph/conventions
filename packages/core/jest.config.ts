import type { Config } from '@jest/types';
// Keep a typed TS config file in-repo while Jest executes the CJS config in ESM package scope.
import config from './jest.config.cjs';

export default config as Config.InitialOptions;
