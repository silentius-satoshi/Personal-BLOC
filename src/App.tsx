import { AppShell } from './components/Layout/AppShell';
import { SignerProvider } from './lib/nostr/SignerContext';

export default function App() {
  return (
    <SignerProvider>
      <AppShell />
    </SignerProvider>
  );
}
