import { AppShell } from './components/Layout/AppShell';
import { RemoteLoginSuccessPage } from './pages/RemoteLoginSuccessPage';
import { useAppHidden } from './hooks/useAppHidden';
import { PrivacyScreen } from './components/PrivacyScreen';

export default function App() {
  const hidden = useAppHidden();   // call before any early return — hooks must run unconditionally

  if (window.location.pathname === '/remoteloginsuccess') {
    return <RemoteLoginSuccessPage />;
  }

  // PrivacyScreen renders LAST + max z-index → covers AppShell AND any gate. AppShell stays mounted
  // underneath (cover, don't unmount → no state/scroll loss on return).
  return (
    <>
      <AppShell />
      {hidden && <PrivacyScreen />}
    </>
  );
}
