import { registerSW } from 'virtual:pwa-register';
import './style.css';
import { openDb } from './db/db';
import { startApp } from './ui/app';

registerSW({ immediate: true });

// Ask iOS not to evict local data (SPEC N7). Ignored where unsupported.
void navigator.storage?.persist?.();

const root = document.querySelector<HTMLDivElement>('#app');
if (root) {
  openDb()
    .then((db) => startApp(root, db))
    .catch((err: unknown) => {
      root.textContent = `Start fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`;
    });
}
