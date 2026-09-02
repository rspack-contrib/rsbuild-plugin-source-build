// Configuration guide: https://rstack.rs/config
import { define } from 'rstack';
import { pluginSourceBuild } from '../dist/index.js';

define.app({
  plugins: [pluginSourceBuild()],
});
