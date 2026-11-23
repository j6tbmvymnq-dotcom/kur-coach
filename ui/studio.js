// Studio (Gym-Logger) – kommt in M2
import { icon } from './icons.js';
import { h } from './util.js';

export async function render(el) {
  el.append(h('div', { class: 'seite schmal' },
    h('h1', { class: 'titel gross' }, 'Studio'),
    h('div', { class: 'karte leer-karte' },
      h('span', { class: 'gross-icon', html: icon('dumbbell', 44) }),
      h('p', null, h('strong', null, 'Der Gym-Logger kommt in M2.')),
      h('p', { class: 'muted' }, 'Bis dahin kannst du Trainings über den KURLOG-Import eintragen.'),
      h('a', { href: '#/heute', class: 'btn' }, 'Zurück zur Übersicht'))));
}
