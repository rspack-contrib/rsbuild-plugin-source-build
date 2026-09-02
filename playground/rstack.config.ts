// Configuration guide: https://rstack.rs/config
import { define } from 'rstack';
import { pluginSourceBuild } from '../src/index.ts';

define.app({
  plugins: [pluginSourceBuild()],
});
