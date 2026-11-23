import {StrictMode, useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.tsx';
import './index.css';
import { AuthProvider } from './contexts/AuthContext';
import { SchoolProvider } from './contexts/SchoolContext';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { testFirestoreConnection } from './services/firebase';

// Normalize legacy ?invite=CODE or clean path links into HashRouter format before mounting
if (typeof window !== 'undefined' && !window.location.hash) {
  const params = new URLSearchParams(window.location.search);
  const invite = params.get('invite');
  if (invite) {
    window.history.replaceState(null, '', `/#/activate?invite=${encodeURIComponent(invite)}`);
  } else if (window.location.pathname && window.location.pathname !== '/') {
    window.history.replaceState(
      null,
      '',
      `/#${window.location.pathname}${window.location.search}`
    );
  }
}

const Root = () => {
  useEffect(() => {
    // Perform initial connectivity test
    testFirestoreConnection();
  }, []);

  return (
    <StrictMode>
      <ErrorBoundary>
        <HashRouter>
          <AuthProvider>
            <SchoolProvider>
              <App />
            </SchoolProvider>
          </AuthProvider>
        </HashRouter>
      </ErrorBoundary>
    </StrictMode>
  );
};

createRoot(document.getElementById('root')!).render(<Root />);

