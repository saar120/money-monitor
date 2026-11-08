import * as SecureStore from 'expo-secure-store';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { LAST_ROOT_TAB_KEY, rootTabHref } from '@/navigation-state';

export default function Index() {
  const [destination, setDestination] = useState<ReturnType<typeof rootTabHref> | null>(null);

  useEffect(() => {
    let current = true;
    SecureStore.getItemAsync(LAST_ROOT_TAB_KEY)
      .then((tab) => {
        if (current) setDestination(rootTabHref(tab));
      })
      .catch(() => {
        if (current) setDestination(rootTabHref(null));
      });
    return () => {
      current = false;
    };
  }, []);

  return destination ? <Redirect href={destination} /> : null;
}
