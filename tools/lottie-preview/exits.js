import { baseColors, primaryColors, radiusTokens } from './tokens.js';
for (const [key, value] of Object.entries({ bg: baseColors.find(c => c.name === 'Background Primary').dark, fg: primaryColors.find(c => c.name === 'Primary').dark, panel: baseColors.find(c => c.name === 'Elevation 2').dark, radius: radiusTokens[10] })) document.documentElement.style.setProperty(`--${key}`, value);
const angles = [-90, -60, -30, 0, 30, 60], players = [];
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
function replay(player) {
  cancelAnimationFrame(player.raf);
  const start = performance.now(), speed = Number(document.getElementById('speed').value);
  function tick(now) {
    const time = Math.min(1.5, (now - start) / 1000 * speed);
    player.svg.setCurrentTime(reduced.matches ? 1.5 : time);
    if (time < 1.5 && !reduced.matches) player.raf = requestAnimationFrame(tick);
  }
  tick(start);
}
try {
  for (const [index, angle] of angles.entries()) {
    const response = await fetch(`exit-variant-${index + 1}.svg`, { cache: 'no-store' });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'image/svg+xml');
    if (doc.querySelector('parsererror')) throw Error('Некорректный SVG');
    const card = document.createElement('section'); card.className = 'card';
    card.innerHTML = `<h2>${index + 1} · ${angle > 0 ? '+' : ''}${angle}°</h2><div class="stage"><div class="disc"></div></div><button>Повторить ${index + 1}</button>`;
    const svg = document.importNode(doc.documentElement, true);
    card.querySelector('.disc').append(svg); document.getElementById('variants').append(card);
    svg.pauseAnimations(); svg.setCurrentTime(0);
    const player = { svg, raf: 0 }; players.push(player);
    card.querySelector('button').onclick = () => replay(player);
  }
  document.getElementById('all').disabled = false;
  document.getElementById('all').onclick = () => players.forEach(replay);
  document.getElementById('status').textContent = 'Выберите «Повторить все», чтобы сравнить переходы одновременно.';
} catch (error) { document.getElementById('status').textContent = `Не удалось загрузить варианты: ${error.message}`; }
