import { CheckCircle } from 'lucide-react';

export function RemoteLoginSuccessPage() {
  return (
    <main style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <div style={{ textAlign: 'center', padding: '2rem', maxWidth: '360px' }}>
        <CheckCircle style={{ width: 64, height: 64, color: '#22c55e', margin: '0 auto 1rem' }} />
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '0.75rem' }}>
          Login approved!
        </h1>
        <p style={{ color: '#6b7280' }}>
          Your signer approved the connection. You can close this tab and return to the app.
        </p>
      </div>
    </main>
  );
}
