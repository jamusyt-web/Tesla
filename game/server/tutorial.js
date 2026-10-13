// The first-session tutorial: the core loop in four steps, each paying a
// little gold. It listens to the event bus, so the systems it watches don't
// need to know it exists.
import { MONSTERS } from '../shared/monsters.js';
import { on } from './events.js';
import { register } from './rpc.js';

export const TUTORIAL = [
  { id: 'chop', text: 'Chop a tree in Whisperwood (west)', reward: 20 },
  { id: 'craft', text: 'Saw Oak Planks at the Workshop', reward: 30 },
  { id: 'fight', text: `Slay a ${MONSTERS.slime.name} beyond the Wilds Gate (north)`, reward: 50 },
  { id: 'stock', text: 'Put something on a display in Your Shop', reward: 60 },
];

export function advanceTutorial(c, stepId) {
  if (!c) return;
  const i = c.hero.tutorial;
  if (i >= TUTORIAL.length || TUTORIAL[i].id !== stepId) return;
  const step = TUTORIAL[i];
  c.game.heroes.addGold(c.hero.id, step.reward, 'tutorial');
  c.game.heroes.setTutorial(c.hero, i + 1);
  c.send({ t: 'tutorial', step: i + 1, done: step.id, reward: step.reward });
  c.pushInventory();
}

on('gather', (c, d) => d.kind === 'tree' && advanceTutorial(c, 'chop'));
on('craft', (c, d) => d.out === 'oak_plank' && advanceTutorial(c, 'craft'));
on('kill', (c) => advanceTutorial(c, 'fight'));
on('stock', (c) => advanceTutorial(c, 'stock'));

register('tutorialSkip', (g, c) => g.heroes.setTutorial(c.hero, TUTORIAL.length), { inRun: true });
