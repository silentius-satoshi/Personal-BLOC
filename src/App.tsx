import { AppShell } from './components/Layout/AppShell';
import { SignerProvider } from './lib/nostr/SignerContext';
import { RemoteLoginSuccessPage } from './pages/RemoteLoginSuccessPage';

export default function App() {
  if (window.location.pathname === '/remoteloginsuccess') {
    return <RemoteLoginSuccessPage />;
  }

  return (
    <SignerProvider>
      <AppShell />
    </SignerProvider>
  );
}
