import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { setupUpdates } from './state/appUpdate';
import { App } from './App';
import { SettingsProvider } from './state/settings';
import { SessionProvider } from './state/session';
import './styles.css';

const { updatedFrom } = setupUpdates();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <SessionProvider>
        <App updatedFrom={updatedFrom} />
      </SessionProvider>
    </SettingsProvider>
  </StrictMode>,
);
