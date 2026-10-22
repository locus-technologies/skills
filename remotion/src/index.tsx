import { Composition, registerRoot } from 'remotion';
import { PackLaunch, TOTAL_FRAMES } from './PackLaunch';
import { type LaunchProps, launchSchema } from './schema';

const placeholder: LaunchProps = {
  pack: 'example',
  hook: 'Render with --props=../packs/<pack>/launch/props.json',
  incumbent: { name: 'Incumbent', price: '$0', unit: '/mo' },
  ours: { cost: '$0', unit: 'per run' },
  prompt: 'example prompt',
  steps: [],
  columns: ['a', 'b', 'c'],
  rows: [],
  summary: [],
  install: 'npx skills add locus-technologies/skills',
  repo: 'github.com/locus-technologies/skills',
};

registerRoot(() => (
  <Composition
    id="PackLaunch"
    component={PackLaunch}
    schema={launchSchema}
    durationInFrames={TOTAL_FRAMES}
    fps={30}
    width={1080}
    height={1080}
    defaultProps={placeholder}
  />
));
