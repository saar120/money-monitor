import * as SecureStore from 'expo-secure-store';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { LAST_ROOT_TAB_KEY, rootTabHref } from '@/navigation-state';

export default function Index() {
  const [destination, setDestination] = useState<ReturnType<typeof rootTabHref> | null>(null);

  useEffect(() => {
    SecureStore.getItemAsync(LAST_ROOT_TAB_KEY)
      .then((tab) => setDestination(rootTabHref(tab)))
      .catch(() => setDestination(rootTabHref(null)));
  }, []);

  return destination ? <Redirect href={destination} /> : null;
}
