import { HashRouter } from 'react-router-dom';
import { AppProviders } from './providers';
import { AppRoutes } from './router';
import { Toasts } from '../components/Toasts';

export function App() {
  return (
    <AppProviders>
      <HashRouter>
        <AppRoutes />
        <Toasts />
      </HashRouter>
    </AppProviders>
  );
}
