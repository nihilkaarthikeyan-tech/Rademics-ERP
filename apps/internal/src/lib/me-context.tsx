'use client';

import { createContext, useContext } from 'react';
import type { Me } from './api';

export const MeContext = createContext<Me | null>(null);

export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe must be used within an authenticated layout');
  return me;
}
