import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
  projects: ['<rootDir>/packages/*/jest.config.cjs'],
};

export default config;
