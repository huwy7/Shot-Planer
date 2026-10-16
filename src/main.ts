import { registerSW } from 'virtual:pwa-register';
import './style.css';
import { renderAttribution } from './ui/attribution';

registerSW({ immediate: true });

// Ask iOS not to evict local data (SPEC N7). Ignored where unsupported.
void navigator.storage?.persist?.();

const app = document.querySelector<HTMLDivElement>('#app');
if (app) {
  app.innerHTML = `
    <main class="screen">
      <h1>Shot-Planer</h1>
      <p class="muted">Gerüst steht. Spots, Licht und Wetter folgen in den nächsten Meilensteinen.</p>
    </main>
    <footer class="bottom-bar"></footer>
  `;
  const footer = app.querySelector<HTMLElement>('.bottom-bar');
  if (footer) renderAttribution(footer);
}
