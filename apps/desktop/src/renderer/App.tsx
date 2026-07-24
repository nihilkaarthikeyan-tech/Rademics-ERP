import { useEffect, useState } from 'react';
import type { AuthState } from '../shared/ipc';
import { LoginScreen } from './LoginScreen';
import { StatusScreen } from './StatusScreen';

export function App() {
  const [state, setState] = useState<AuthState | null>(null);
  const [version, setVersion] = useState('');

  useEffect(() => {
    window.rademicsDesktop.getAuthState().then(setState);
    void window.rademicsDesktop.getAppVersion().then(setVersion);
    const unsubscribe = window.rademicsDesktop.onAuthStateChanged(setState);
    return unsubscribe;
  }, []);

  if (!state) return null; // brief flash while the initial state loads

  return (
    // No background here — the body carries the shared Aurora Glass ground
    // (styles.css), same as the staff portal, and the cards blur through it.
    <div className="relative h-screen">
      {state.authenticated && state.user ? <StatusScreen user={state.user} /> : <LoginScreen />}
      {version ? (
        <p className="pointer-events-none absolute bottom-1.5 right-3 font-mono text-[10px] tracking-widest text-slate-400">
          v{version}
        </p>
      ) : null}
    </div>
  );
}
