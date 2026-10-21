import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';

createRoot(document.getElementById('root')!).render(<App />);

// Service worker (PWA offline opening scene). Skipped in dev and inside the Capacitor shell,
// where assets are already packaged locally.
if ('serviceWorker' in navigator && import.meta.env.PROD && !(window as unknown as { Capacitor?: { isNativePlatform(): boolean } }).Capacitor?.isNativePlatform()) {
  void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })).catch(() => {});
}
