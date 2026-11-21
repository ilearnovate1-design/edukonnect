import {StrictMode, useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
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
        <BrowserRouter>
          <AuthProvider>
            <SchoolProvider>
              <App />
            </SchoolProvider>
          </AuthProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </StrictMode>
  );
};

createRoot(document.getElementById('root')!).render(<Root />);

