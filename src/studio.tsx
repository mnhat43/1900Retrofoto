import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/studio/StudioApp.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
