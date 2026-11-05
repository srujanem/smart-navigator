import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

// Restore Senior High-Contrast Large-Text preference immediately before first paint
try {
  if (localStorage.getItem('navigator_senior_mode') === '1') {
    document.documentElement.classList.add('senior-mode');
  }
} catch {
  // Ignore
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Ignore SW registration errors on restricted browsers
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
