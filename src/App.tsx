import { AppShell } from './components/Layout/AppShell';
import { RemoteLoginSuccessPage } from './pages/RemoteLoginSuccessPage';

export default function App() {
  if (window.location.pathname === '/remoteloginsuccess') {
    return <RemoteLoginSuccessPage />;
  }

  return <AppShell />;
}
