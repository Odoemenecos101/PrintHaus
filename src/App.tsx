import { useEffect, useState } from 'react';
import { signOut } from 'firebase/auth';
import { ArrowRight, GraduationCap, LogOut, QrCode, ShieldCheck } from 'lucide-react';
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
import { apiFetch, setSessionToken } from './lib/api';
import {
  PricingConfig,
  UserAccount,
  UserRole,
  getPrimaryRole,
  getUserRoles,
  userHasRole,
} from './types/printhaus';

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

const ROLE_CARDS: Record<
  UserRole,
  {
    title: string;
    badge: string;
    description: string;
    actionLabel: string;
  }
> = {
  student: {
    title: 'Student Dashboard',
    badge: 'STUDENT',
    description:
      'Upload PDF or Word documents, preview Naira totals, track print stages, and show your collection QR code.',
    actionLabel: 'Open Student Portal',
  },
  staff: {
    title: 'Staff Dashboard',
    badge: 'STAFF',
    description:
      'Manage active print orders, scan student QR slips at pickup, confirm collections, and review collection logs.',
    actionLabel: 'Open Staff Portal',
  },
  admin: {
    title: 'Admin Dashboard',
    badge: 'ADMIN',
    description:
      'Manage staff permissions, pricing rules, printing partners, revenue economics, and student complaints.',
    actionLabel: 'Open Admin Portal',
  },
};

export default function App() {
  const { firebaseUser, authReady } = useFirebase();
  const [pricing, setPricing] = useState<PricingConfig>(DEFAULT_PRICING);
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [activeDashboard, setActiveDashboard] = useState<UserRole | null>(null);
  const [showDashboardSelector, setShowDashboardSelector] = useState(false);
  const [viewMode, setViewMode] = useState<'landing' | 'portal'>('landing');
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register'>('login');

  useEffect(() => {
    try {
      localStorage.removeItem('printhaus_user_session');
    } catch {}
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
        const meRes = await apiFetch('/api/auth/me');
        if (!active) return;
        if (meRes.ok) {
          const meData = await meRes.json();
          if (meData.user) {
            const hydrated = meData.user as UserAccount;
            const roles = getUserRoles(hydrated);
            setCurrentUser(hydrated);
            setActiveDashboard((prev) =>
              prev && roles.includes(prev) ? prev : getPrimaryRole(roles)
            );
            return;
          }
        }
        if (meRes.status === 403) {
          await signOut(auth).catch(() => {});
          setCurrentUser(null);
          setActiveDashboard(null);
          return;
        }

        const profile = await fetchFirestoreUserProfile(firebaseUser.uid).catch(() => null);
        if (!active || !profile) return;
        const synced = await syncFirebaseUserWithServer(profile);
        if (!active) return;
        const roles = getUserRoles(synced);
        setCurrentUser(synced);
        setActiveDashboard((prev) =>
          prev && roles.includes(prev) ? prev : getPrimaryRole(roles)
        );
      } catch {
        // Ignore transient startup network errors
      }
    })();
    return () => {
      active = false;
    };
  }, [authReady, firebaseUser]);

  const handleAuthenticated = (user: UserAccount) => {
    const roles = getUserRoles(user);
    const normalizedUser: UserAccount = {
      ...user,
      roles,
      role: getPrimaryRole(roles),
    };
    setCurrentUser(normalizedUser);
    setAuthModalOpen(false);
    setViewMode('portal');
    if (roles.length > 1) {
      setActiveDashboard(null);
      setShowDashboardSelector(true);
    } else {
      setActiveDashboard(roles[0] || 'student');
      setShowDashboardSelector(false);
    }
  };

  const handleLogout = async () => {
    setSessionToken(null);
    setCurrentUser(null);
    setActiveDashboard(null);
    setShowDashboardSelector(false);
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
      const roles = getUserRoles(currentUser);
      if (roles.includes('student')) {
        setActiveDashboard('student');
        setShowDashboardSelector(false);
      } else if (roles.length > 1) {
        setShowDashboardSelector(true);
      } else {
        setActiveDashboard(roles[0] || 'student');
      }
      setViewMode('portal');
    } else {
      handleOpenAuth('login');
    }
  };

  const handleSelectDashboard = (role: UserRole) => {
    if (!currentUser) return;
    const roles = getUserRoles(currentUser);
    if (!roles.includes(role)) return;
    setActiveDashboard(role);
    setShowDashboardSelector(false);
    setViewMode('portal');
  };

  const handleEnterPortalFromLanding = () => {
    if (!currentUser) {
      handleOpenAuth('login');
      return;
    }
    const roles = getUserRoles(currentUser);
    if (roles.length > 1 && !activeDashboard) {
      setShowDashboardSelector(true);
    } else if (!activeDashboard) {
      setActiveDashboard(getPrimaryRole(roles));
    }
    setViewMode('portal');
  };

  if (viewMode === 'portal' && currentUser) {
    const userRoles = getUserRoles(currentUser);

    if (showDashboardSelector && userRoles.length > 1) {
      return (
        <div className="min-h-screen bg-[#FAF9F6] text-slate-900 flex flex-col">
          <header className="h-16 px-6 bg-white border-b border-slate-200 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setViewMode('landing')}
              className="font-display text-lg font-bold tracking-tight text-slate-950 cursor-pointer"
            >
              PrintHaus
            </button>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setViewMode('landing')}
                className="py-1.5 px-3 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                Public Site
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-1.5 py-1.5 px-3 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          </header>

          <main className="flex-1 flex items-center justify-center p-6">
            <div className="w-full max-w-4xl space-y-6">
              <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-medium text-blue-800">Multi-Role Account</p>
                  <h1 className="font-display text-2xl font-bold text-slate-950 mt-1">
                    Welcome back, {currentUser.name}
                  </h1>
                  <p className="text-xs text-slate-500 mt-1 font-mono">
                    {currentUser.email} · Authorized roles: {userRoles.join(', ')}
                  </p>
                </div>
                <p className="text-xs text-slate-600 max-w-xs">
                  Choose which workspace to open. You can switch dashboards anytime without signing out.
                </p>
              </div>

              <div
                className={`grid grid-cols-1 ${
                  userRoles.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-3'
                } gap-5`}
              >
                {userRoles.map((role) => {
                  const meta = ROLE_CARDS[role];
                  const Icon =
                    role === 'student'
                      ? GraduationCap
                      : role === 'staff'
                        ? QrCode
                        : ShieldCheck;
                  return (
                    <button
                      key={role}
                      type="button"
                      onClick={() => handleSelectDashboard(role)}
                      className="text-left p-6 bg-white border border-slate-200 hover:border-blue-700 rounded-xl transition-all group cursor-pointer flex flex-col justify-between gap-6"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <div className="w-10 h-10 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-800">
                            <Icon className="w-5 h-5" />
                          </div>
                          <span className="font-mono text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                            {meta.badge}
                          </span>
                        </div>
                        <h2 className="text-base font-semibold text-slate-950 mt-4">
                          {meta.title}
                        </h2>
                        <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                          {meta.description}
                        </p>
                      </div>

                      <div className="inline-flex items-center gap-2 text-xs font-semibold text-blue-800 group-hover:text-blue-950">
                        <span>{meta.actionLabel}</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </main>
        </div>
      );
    }

    const resolvedDashboard: UserRole =
      activeDashboard && userRoles.includes(activeDashboard)
        ? activeDashboard
        : getPrimaryRole(userRoles);

    if (resolvedDashboard === 'staff' && (userHasRole(currentUser, 'staff') || userHasRole(currentUser, 'admin'))) {
      return (
        <>
          <StaffPortal
            user={currentUser}
            availableRoles={userRoles}
            onSelectDashboard={handleSelectDashboard}
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

    if (resolvedDashboard === 'admin' && userHasRole(currentUser, 'admin')) {
      return (
        <>
          <AdminPortal
            user={currentUser}
            availableRoles={userRoles}
            onSelectDashboard={handleSelectDashboard}
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
          availableRoles={userRoles}
          onSelectDashboard={handleSelectDashboard}
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
        onEnterPortal={handleEnterPortalFromLanding}
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
