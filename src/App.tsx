import { useEffect, useState } from 'react';
import { signOut } from 'firebase/auth';
import { AuthModal } from './components/AuthModal';
import { LandingView } from './components/LandingView';
import { StudentPortal } from './components/StudentPortal';
import { StaffPortal } from './components/StaffPortal';
import { AdminPortal } from './components/AdminPortal';
import { useFirebase } from './context/FirebaseContext';
import {
  auth,
  fetchFirestoreUserProfile,
  syncFirebaseUserWithServer,
} from './firebase';
import { PricingConfig, UserAccount } from './types/printhaus';

const DEFAULT_PRICING: PricingConfig = {
  bwSinglePerPage: 200,
  bwDoublePerPage: 180,
  colorSinglePerPage: 350,
  colorDoublePerPage: 300,
  stapling: 100,
  spiralBinding: 1000,
  laminationPerPage: 150,
  urgentFee: 200,
  packagingFee: 50,
  operatingCostPerOrder: 50,
  partnerBwRate: 120,
  partnerColorRate: 220,
  firstOrderDiscountPct: 10,
  bulkThresholdDocuments: 3,
  bulkDiscountPct: 15,
  updatedAt: new Date().toISOString(),
};

const STORAGE_KEY = 'printhaus_user_session';

export default function App() {
  const { firebaseUser, authReady } = useFirebase();
  const [pricing, setPricing] = useState<PricingConfig>(DEFAULT_PRICING);
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? (JSON.parse(saved) as UserAccount) : null;
    } catch {
      return null;
    }
  });
  const [viewMode, setViewMode] = useState<'landing' | 'portal'>('landing');
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register'>('login');

  useEffect(() => {
    fetch('/api/pricing')
      .then((res) => res.json())
      .then((data) => {
        if (data.pricing) setPricing(data.pricing);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!authReady || !firebaseUser) return;
    let active = true;
    (async () => {
      try {
        const profile = await fetchFirestoreUserProfile(firebaseUser.uid);
        if (!active || !profile) return;
        const synced = await syncFirebaseUserWithServer(profile);
        if (!active) return;
        setCurrentUser(synced);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(synced));
        } catch {}
      } catch {
        // Handled by FirebaseError / ErrorBoundary if permissions fail
      }
    })();
    return () => {
      active = false;
    };
  }, [authReady, firebaseUser]);

  const handleAuthenticated = (user: UserAccount) => {
    setCurrentUser(user);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    } catch {}
    setAuthModalOpen(false);
    setViewMode('portal');
  };

  const handleLogout = async () => {
    setCurrentUser(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    if (auth.currentUser) {
      await signOut(auth).catch(() => {});
    }
    setViewMode('landing');
  };

  const handleOpenAuth = (mode: 'login' | 'register' = 'login') => {
    setAuthModalMode(mode);
    setAuthModalOpen(true);
  };

  const handleStartOrder = () => {
    if (currentUser) {
      setViewMode('portal');
    } else {
      handleOpenAuth('login');
    }
  };

  if (viewMode === 'portal' && currentUser) {
    if (currentUser.role === 'staff') {
      return (
        <>
          <StaffPortal
            user={currentUser}
            onBackHome={() => setViewMode('landing')}
            onLogout={handleLogout}
            onSwitchRole={() => handleOpenAuth('login')}
          />
          <AuthModal
            isOpen={authModalOpen}
            initialMode={authModalMode}
            onClose={() => setAuthModalOpen(false)}
            onAuthenticated={handleAuthenticated}
          />
        </>
      );
    }

    if (currentUser.role === 'admin') {
      return (
        <>
          <AdminPortal
            user={currentUser}
            pricing={pricing}
            onPricingUpdated={setPricing}
            onBackHome={() => setViewMode('landing')}
            onLogout={handleLogout}
            onSwitchRole={() => handleOpenAuth('login')}
          />
          <AuthModal
            isOpen={authModalOpen}
            initialMode={authModalMode}
            onClose={() => setAuthModalOpen(false)}
            onAuthenticated={handleAuthenticated}
          />
        </>
      );
    }

    return (
      <>
        <StudentPortal
          user={currentUser}
          pricing={pricing}
          onBackHome={() => setViewMode('landing')}
          onLogout={handleLogout}
          onSwitchRole={() => handleOpenAuth('login')}
        />
        <AuthModal
          isOpen={authModalOpen}
          initialMode={authModalMode}
          onClose={() => setAuthModalOpen(false)}
          onAuthenticated={handleAuthenticated}
        />
      </>
    );
  }

  return (
    <>
      <LandingView
        pricing={pricing}
        currentUser={currentUser}
        onStartOrder={handleStartOrder}
        onOpenAuth={handleOpenAuth}
        onEnterPortal={() => setViewMode('portal')}
      />
      <AuthModal
        isOpen={authModalOpen}
        initialMode={authModalMode}
        onClose={() => setAuthModalOpen(false)}
        onAuthenticated={handleAuthenticated}
      />
    </>
  );
}
