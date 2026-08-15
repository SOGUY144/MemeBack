// Offline, dev-run-once script: renders one looping background per SETTING
// and writes it to public/backgrounds/<setting>.{mp4,jpg}. Never called from
// the request path — see src/server/kling.ts and src/server/sora.ts for why.
//
// Usage:
//   npm run gen:backgrounds                          # all 7, provider auto-picked
//   npm run gen:backgrounds -- classroom              # just one
//   npm run gen:backgrounds -- --provider=sora        # force Sora (video, looping)
//   npm run gen:backgrounds -- --provider=kling       # force Kling (static image)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// tsx doesn't source .env on its own (unlike `next()`, which server.ts relies
// on) — load it explicitly so *_API_KEY is visible to this standalone script.
try {
  process.loadEnvFile(join(process.cwd(), '.env'));
} catch {
  // no .env file — fine if the vars are set some other way (CI, shell export)
}

import { generateImage } from '../src/server/kling';
import { generateVideo } from '../src/server/sora';
import { SETTINGS, type SettingName } from '../src/lib/meme/vocab';

type Provider = 'kling' | 'sora';

const STYLE =
  'flat vector illustration, thick clean black outlines, bold flat colors, ' +
  'simple geometric shapes, no gradients besides sky, cheerful classroom-safe ' +
  'cartoon style, wide empty ground area in the lower third for characters to ' +
  'stand on, no people, no text, no watermark, 16:9';

const IMAGE_PROMPTS: Record<SettingName, string> = {
  classroom: `a bright classroom interior with a chalkboard and a window, ${STYLE}`,
  street: `a cheerful city street with cartoon buildings and a lamppost, ${STYLE}`,
  water: `a calm cartoon ocean scene with sun and clouds, ${STYLE}`,
  space: `a cartoon starfield with a planet and a comet, dark background, ${STYLE}`,
  kitchen: `a tidy cartoon kitchen with a stove and a window, ${STYLE}`,
  field: `a sunny cartoon grass field with a tree and clouds, ${STYLE}`,
  void: `an abstract dark gradient void with faint geometric perspective lines, ${STYLE}`,
};

// Sora renders motion, so these describe *ambient, seamlessly loopable* movement
// instead of a static composition — the renderer plays this back on repeat.
const VIDEO_PROMPTS: Record<SettingName, string> = {
  classroom: `a bright cartoon classroom, curtains swaying gently, dust motes drifting in a sunbeam, seamless ambient loop, static camera, ${STYLE}`,
  street: `a cheerful cartoon city street, a flag fluttering, clouds drifting slowly, seamless ambient loop, static camera, ${STYLE}`,
  water: `a calm cartoon ocean, small waves rolling, clouds drifting, sun glinting on the water, seamless ambient loop, static camera, ${STYLE}`,
  space: `a cartoon starfield, a comet drifting slowly, a distant planet slowly rotating, seamless ambient loop, static camera, ${STYLE}`,
  kitchen: `a tidy cartoon kitchen, steam rising gently from a pot, seamless ambient loop, static camera, ${STYLE}`,
  field: `a sunny cartoon grass field, tall grass swaying in the wind, clouds drifting, seamless ambient loop, static camera, ${STYLE}`,
  void: `an abstract dark gradient void, faint geometric lines slowly pulsing, seamless ambient loop, static camera, ${STYLE}`,
};

function pickProvider(argv: string[]): Provider {
  const flag = argv.find((a) => a.startsWith('--provider'));
  if (flag) {
    const value = flag.includes('=') ? flag.split('=')[1] : argv[argv.indexOf(flag) + 1];
    if (value === 'kling' || value === 'sora') return value;
    console.error(`--provider must be "kling" or "sora", got "${value}"`);
    process.exit(1);
  }
  if (process.env.OPENAI_API_KEY) return 'sora';
  if (process.env.KLING_API_KEY) return 'kling';
  console.error('Set OPENAI_API_KEY (Sora) or KLING_API_KEY (Kling) in .env first.');
  process.exit(1);
}

async function main() {
  const argv = process.argv.slice(2);
  const provider = pickProvider(argv);

  const only = argv.find((a) => !a.startsWith('--') && a !== provider) as SettingName | undefined;
  const targets = only ? [only] : [...SETTINGS];

  for (const setting of targets) {
    if (!SETTINGS.includes(setting)) {
      console.error(`Unknown setting "${setting}". Valid: ${SETTINGS.join(', ')}`);
      process.exitCode = 1;
      return;
    }
  }

  const outDir = join(process.cwd(), 'public', 'backgrounds');
  mkdirSync(outDir, { recursive: true });

  console.log(`[gen:backgrounds] provider: ${provider}`);
  for (const setting of targets) {
    process.stdout.write(`[gen:backgrounds] ${setting} ... `);
    try {
      if (provider === 'sora') {
        const bytes = await generateVideo({ prompt: VIDEO_PROMPTS[setting], size: '1280x720', seconds: '8' });
        writeFileSync(join(outDir, `${setting}.mp4`), bytes);
      } else {
        const bytes = await generateImage({ prompt: IMAGE_PROMPTS[setting], aspectRatio: '16:9' });
        writeFileSync(join(outDir, `${setting}.jpg`), bytes);
      }
      console.log('done');
    } catch (err) {
      console.log('FAILED');
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    }
  }
}

main();
