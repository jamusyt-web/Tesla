// The dock of big buttons along the bottom. It changes with where you are:
// in town (bag, craft, market, shop, book, town), inside a shop (leave, bag, the
// ledger if it's yours, other shops) and down a dungeon (leave, bag, map, party).
import { h } from '../util/dom.js';
import { sfx } from '../util/sfx.js';
import { glyph } from './glyphs.js';

export class Dock {
  constructor(hud) {
    const dockBtn = (ic, label, fn, badge) => h('button', { 'aria-label': label, on: { click: () => (sfx.tap(), fn()) } }, glyph(ic), h('span', label), badge);
    this.shopBadge = h('i.badge.hidden', '0');
    this.town = h(
      'div.dock',
      dockBtn('bag', 'Bag', () => hud.panels.open('bag')),
      // These open straight away; the panel has a "Walk there" button too.
      dockBtn('anvil', 'Craft', () => hud.openPlace('craft')),
      dockBtn('scales', 'Market', () => hud.openPlace('market')),
      dockBtn('shop', 'Shop', () => hud.game?.enterShop(hud.myId), this.shopBadge),
      dockBtn('book', 'Book', () => hud.panels.open('book')),
      dockBtn('castle', 'Town', () => hud.openPlace('townhall')),
    );
    this.ledgerBtn = dockBtn('scroll', 'Ledger', () => hud.panels.open('ledger'));
    this.room = h(
      'div.dock.hidden',
      dockBtn('door', 'Leave', () => hud.game?.exitShop()),
      dockBtn('bag', 'Bag', () => hud.panels.open('bag')),
      this.ledgerBtn,
      dockBtn('village', 'Shops', () => hud.panels.open('shops')),
    );
    this.dungeon = h(
      'div.dock.hidden',
      (this.leaveBtn = dockBtn('door', 'Leave', () => hud.panels.open('dleave'))),
      dockBtn('bag', 'Bag', () => hud.panels.open('bag')),
      dockBtn('map', 'Map', () => hud.panels.open('dmap')),
      dockBtn('people', 'Party', () => hud.panels.open('party')),
    );
    this.els = [this.town, this.room, this.dungeon];
  }

  // Show the dock for `mode` ('town', 'room' or 'dungeon'); none while fighting.
  show(mode, fighting) {
    this.town.classList.toggle('hidden', fighting || mode !== 'town');
    this.room.classList.toggle('hidden', fighting || mode !== 'room');
    this.dungeon.classList.toggle('hidden', fighting || mode !== 'dungeon');
  }
  setOwner(isOwner) {
    this.ledgerBtn.style.display = isOwner ? '' : 'none';
  }
  // Gold waiting in your shop's till, on the Shop button.
  setTill(till) {
    this.shopBadge.textContent = till >= 1000 ? `${(till / 1000).toFixed(till >= 10000 ? 0 : 1)}k` : String(till);
    this.shopBadge.classList.toggle('hidden', !till);
  }
}
