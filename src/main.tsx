import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import App from './App.tsx';
import { NostrProvider } from './providers/NostrProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NostrProvider>
      <App />
    </NostrProvider>
  </StrictMode>,
);
