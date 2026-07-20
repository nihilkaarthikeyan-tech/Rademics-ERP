import { useEffect, useState } from 'react';
import type { AuthState } from '../shared/ipc';
import { LoginScreen } from './LoginScreen';
import { StatusScreen } from './StatusScreen';

export function App() {
  const [state, setState] = useState<AuthState | null>(null);

  useEffect(() => {
    window.rademicsDesktop.getAuthState().then(setState);
    const unsubscribe = window.rademicsDesktop.onAuthStateChanged(setState);
    return unsubscribe;
  }, []);

  if (!state) return null; // brief flash while the initial state loads

  return (
    // No background here — the body carries the shared Aurora Glass ground
    // (styles.css), same as the staff portal, and the cards blur through it.
    <div className="h-screen">
      {state.authenticated && state.user ? <StatusScreen user={state.user} /> : <LoginScreen />}
    </div>
  );
}
