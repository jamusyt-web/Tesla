// The first-session tutorial is now the first four steps of Hearthvale's
// intro quest (shared/content/hearthvale/quests.js, run by server/quests.js).
// This file keeps the old names working: TUTORIAL, heroes.tutorial (kept in
// step) and the tutorialSkip RPC.
import { QUESTS } from '../shared/quests.js';
import { on } from './events.js';
import { register } from './rpc.js';

const IDS = ['chop', 'craft', 'fight', 'stock'];
export const TUTORIAL = QUESTS.hv_intro.steps.slice(0, 4).map((s, i) => ({ id: IDS[i], text: s.text, reward: s.reward?.gold ?? 0 }));

on('questStep', (c, d) => d.id === 'hv_intro' && d.step < TUTORIAL.length && c.game.heroes.setTutorial(c.hero, d.step + 1));
on('questDone', (c, d) => d.id === 'hv_intro' && c.hero.tutorial < TUTORIAL.length && c.game.heroes.setTutorial(c.hero, TUTORIAL.length));

// Skip the first four steps (no rewards): straight on to step 5.
register(
  'tutorialSkip',
  (g, c) => {
    g.quests.skipTo(c, 'hv_intro', TUTORIAL.length);
    g.heroes.setTutorial(c.hero, TUTORIAL.length);
  },
  { inRun: true },
);
