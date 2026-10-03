import {StrictMode, useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { AuthProvider } from './contexts/AuthContext';
import { SchoolProvider } from './contexts/SchoolContext';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { testFirestoreConnection } from './services/firebase';

const Root = () => {
  useEffect(() => {
    // Perform initial connectivity test
    testFirestoreConnection();
  }, []);

  return (
    <StrictMode>
      <ErrorBoundary>
        <AuthProvider>
          <SchoolProvider>
            <App />
          </SchoolProvider>
        </AuthProvider>
      </ErrorBoundary>
    </StrictMode>
  );
};

createRoot(document.getElementById('root')!).render(<Root />);

