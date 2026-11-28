import { addReactError } from '@datadog/browser-rum-react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import AboutPage from './AboutPage';
import './styles.css';
import { startObservability } from './observability';
import TutorialPage from './TutorialPage';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing #root element.');
}

startObservability();

function Page() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/about') return <AboutPage />;
  if (path === '/tutorial') return <TutorialPage />;
  return <App />;
}

createRoot(root, {
  onUncaughtError: (error, errorInfo) => addReactError(error, errorInfo),
  onCaughtError: (error, errorInfo) => addReactError(error, errorInfo),
  onRecoverableError: (error, errorInfo) => addReactError(error, errorInfo),
}).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
