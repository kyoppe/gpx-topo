import { addReactError } from '@datadog/browser-rum-react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import './styles.css';
import { startObservability } from './observability';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing #root element.');
}

startObservability();

createRoot(root, {
  onUncaughtError: (error, errorInfo) => addReactError(error, errorInfo),
  onCaughtError: (error, errorInfo) => addReactError(error, errorInfo),
  onRecoverableError: (error, errorInfo) => addReactError(error, errorInfo),
}).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
