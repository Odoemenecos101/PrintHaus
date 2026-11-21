import React, { createContext, useContext, useEffect, useState } from 'react';
import { User as FirebaseUser, onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';

interface FirebaseContextValue {
  firebaseUser: FirebaseUser | null;
  authReady: boolean;
}

const FirebaseContext = createContext<FirebaseContextValue>({
  firebaseUser: null,
  authReady: false,
});

export function FirebaseProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  return (
    <FirebaseContext.Provider value={{ firebaseUser, authReady }}>
      {children}
    </FirebaseContext.Provider>
  );
}

export function useFirebase() {
  return useContext(FirebaseContext);
}
