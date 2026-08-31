import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/staff/StaffApp.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
