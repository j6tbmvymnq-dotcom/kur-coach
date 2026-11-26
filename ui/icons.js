// Inline-SVG-Icons (keine Emojis/Unicode-Symbole). icon('name', größe) -> SVG-String
const P = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-6h4v6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  dumbbell: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/>',
  scale: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 10a4 4 0 018 0z"/><path d="M12 10l1.6-2.2"/>',
  steps: '<ellipse cx="8" cy="8" rx="2.6" ry="4"/><path d="M6.5 15.5h3v2a1.5 1.5 0 01-3 0z"/><ellipse cx="16" cy="12" rx="2.6" ry="4"/><path d="M14.5 19.5h3v.5a1.5 1.5 0 01-3 0z"/>',
  upload: '<path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3"/>',
  download: '<path d="M12 4v12"/><path d="M7 11l5 5 5-5"/><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  flame: '<path d="M12 3c1 4 5 5.5 5 10a5 5 0 01-10 0c0-2 1-3 2-4 .3 1.3 1 2 2 2-.5-3 0-5 1-8z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6.5 7l1 13h9l1-13"/><path d="M10 11v6M14 11v6"/>',
  minus: '<path d="M5 12h14"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  cloud: '<path d="M7 18a4 4 0 01-.5-8 5.5 5.5 0 0110.7 1A3.5 3.5 0 0117 18z"/>',
  cloudoff: '<path d="M3 3l18 18"/><path d="M7 18a4 4 0 01-.5-8c.3-.9.8-1.6 1.5-2.2"/><path d="M10 6.2a5.5 5.5 0 017.2 4.8A3.5 3.5 0 0121 14.5c0 1-.4 1.9-1 2.5"/><path d="M9 18h8"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
  sauna: '<path d="M4 16c2-2 2-4 0-6M10 16c2-2 2-4 0-6M16 16c2-2 2-4 0-6"/><path d="M3 20h18"/>',
  food: '<path d="M7 3v7a2 2 0 002 2v9M11 3v7a2 2 0 01-2 2M17 21V3c-2 1.5-3 4-3 7v3h3"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  share: '<path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M5 12v7a1 1 0 001 1h12a1 1 0 001-1v-7"/>',
  play: '<path d="M8 5l11 7-11 7z"/>',
  sync: '<path d="M20 11a8 8 0 00-14-4L4 9"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0014 4l2-2"/><path d="M20 20v-5h-5"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  walk: '<circle cx="13" cy="4.5" r="1.8"/><path d="M12 8l-2.5 4.5 3 3V21M12 8l3 3 3 .5M9.5 12.5L7 17"/>',
};

export function icon(name, size = 22) {
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name] || ''}</svg>`;
}
