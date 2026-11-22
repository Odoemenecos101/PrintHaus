import React, { useEffect, useState } from 'react';
import { User as FirebaseUser, signInWithPopup, signOut } from 'firebase/auth';
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, Mail, X } from 'lucide-react';
import {
  MissingFirestoreProfileError,
  auth,
  createFirestoreUserProfile,
  fetchFirestoreUserProfile,
  googleProvider,
  syncFirebaseUserWithServer,
  registerEmailPasswordUser,
  loginWithEmailPassword,
} from '../firebase';
import { setSessionToken } from '../lib/api';
import {
  HostelGender,
  PAU_FEMALE_HOSTELS,
  PAU_MALE_HOSTELS,
  PAU_SCHOOLS,
  ResidencyType,
  UserAccount,
  getSchoolForProgramme,
} from '../types/printhaus';

interface AuthModalProps {
  isOpen: boolean;
  initialMode?: 'login' | 'register';
  onClose: () => void;
  onAuthenticated: (user: UserAccount) => void;
}

const DEMO_USERS = [
  {
    label: 'PAU Student (Off-Campus)',
    name: 'Chidinma Okafor',
    email: 'chidinma.okafor@pau.edu.ng',
    pass: 'student123',
    detail: '22120612944 · Computer Science',
  },
  {
    label: 'PAU Student (On-Campus)',
    name: 'Toluwanimi Adeyemi',
    email: 'tolu.adeyemi@pau.edu.ng',
    pass: 'student123',
    detail: '21110311408 · Accounting · Cooperative Queens Hostel',
  },
  {
    label: 'Printing Staff & Pickup Desk',
    name: 'Emeka Nwosu',
    email: 'staff@printhaus.ng',
    pass: 'staff123',
    detail: 'Print Operations & Pickup Attendant',
  },
  {
    label: 'System Administrator',
    name: 'Amara Eze',
    email: 'admin@printhaus.ng',
    pass: 'admin123',
    detail: 'Pricing, Partners, Finance & Accounts',
  },
];

export function AuthModal({
  isOpen,
  initialMode = 'login',
  onClose,
  onAuthenticated,
}: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'register' | 'complete-google' | 'forgot-password'>(
    initialMode
  );
  const [forgotStep, setForgotStep] = useState<
    'request-email' | 'verify-code' | 'choose-action' | 'new-password'
  >('request-email');
  const [pendingGoogleUser, setPendingGoogleUser] = useState<FirebaseUser | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [resetCode, setResetCode] = useState('');
  const [recoveryToken, setRecoveryToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);
  const [forgotInfo, setForgotInfo] = useState<string | null>(null);
  const [previewOtpCode, setPreviewOtpCode] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [matricNumber, setMatricNumber] = useState('');
  const [department, setDepartment] = useState('Computer Science');
  const [residency, setResidency] = useState<ResidencyType>('off-campus');
  const [hostelGender, setHostelGender] = useState<HostelGender>('male');
  const [hostelName, setHostelName] = useState<string>(PAU_MALE_HOSTELS[0]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setForgotStep('request-email');
      setPendingGoogleUser(null);
      setShowPassword(false);
      setShowNewPassword(false);
      setShowConfirmNewPassword(false);
      setResetCode('');
      setRecoveryToken('');
      setNewPassword('');
      setConfirmNewPassword('');
      setForgotInfo(null);
      setPreviewOtpCode(null);
      setError(null);
    }
  }, [isOpen, initialMode]);

  if (!isOpen) return null;

  const handleGoogleAuth = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const credential = await signInWithPopup(auth, googleProvider);
      const fbUser = credential.user;
      setSessionToken(null);
      const idToken = await fbUser.getIdToken();

      const existingProfile = await fetchFirestoreUserProfile(fbUser.uid).catch(() => null);

      if (existingProfile) {
        if (existingProfile.status === 'suspended') {
          await signOut(auth).catch(() => {});
          setError('This account has been deactivated or suspended. Contact PrintHaus Admin.');
          return;
        }
        const synced = await syncFirebaseUserWithServer(existingProfile, idToken);
        onAuthenticated(synced);
        return;
      }

      // Check if an admin pre-invited this email (e.g. staff or multi-role Gmail)
      const checkRes = await fetch('/api/auth/firebase-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ checkOnly: true }),
      });
      if (checkRes.status === 403) {
        const errData = await checkRes.json().catch(() => ({}));
        await signOut(auth).catch(() => {});
        setError(errData.error || 'This account has been deactivated or suspended.');
        return;
      }
      if (checkRes.ok) {
        const checkData = await checkRes.json();
        if (checkData.user) {
          onAuthenticated(checkData.user as UserAccount);
          return;
        }
      }

      // First-time student sign-in: collect PAU profile details once
      setPendingGoogleUser(fbUser);
      setName(fbUser.displayName || '');
      setEmail(fbUser.email || '');
      setMode('complete-google');
    } catch (err: unknown) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code?: string }).code)
          : '';
      if (code === 'auth/popup-blocked') {
        setError(
          'Pop-up was blocked by your browser. Allow pop-ups for this site and tap Continue with Google again.'
        );
      } else if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setError('Google sign-in was cancelled. Please try again.');
      } else {
        setError(
          err instanceof Error ? err.message : 'Unable to sign in with Google right now.'
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompleteGoogleProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingGoogleUser) return;
    setError(null);
    setSubmitting(true);
    try {
      const created = await createFirestoreUserProfile(pendingGoogleUser, {
        name,
        matricNumber,
        department,
        residency,
        hostelGender: residency === 'on-campus' ? hostelGender : undefined,
        hostelName: residency === 'on-campus' ? hostelName : undefined,
      });
      const synced = await syncFirebaseUserWithServer(created);
      setPendingGoogleUser(null);
      onAuthenticated(synced);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not save your PrintHaus profile.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  
const handleLogin = async (loginEmail: string, loginPass: string) => {
  setError(null);
  setSubmitting(true);

  const isSeededDemo = DEMO_USERS.some(
    (d) => d.email.toLowerCase() === loginEmail.trim().toLowerCase()
  );

  try {
    if (!isSeededDemo) {
      try {
        const profile = await loginWithEmailPassword(loginEmail, loginPass);
        setSessionToken(null);
        const synced = await syncFirebaseUserWithServer(profile);
        onAuthenticated(synced);
        return;
      } catch (fbErr: unknown) {
        if (fbErr instanceof MissingFirestoreProfileError) {
          setPendingGoogleUser(fbErr.firebaseUser);
          setName(fbErr.firebaseUser.displayName || '');
          setEmail(fbErr.firebaseUser.email || loginEmail.trim());
          setMode('complete-google');
          setError(null);
          return;
        }
        const code =
          fbErr && typeof fbErr === 'object' && 'code' in fbErr
            ? String((fbErr as { code?: string }).code)
            : '';
        if (
          ![
            'auth/invalid-credential',
            'auth/user-not-found',
            'auth/wrong-password',
            'auth/operation-not-allowed',
          ].includes(code)
        ) {
          throw fbErr;
        }
      }
    }

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: loginEmail, password: loginPass }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Invalid email or password.');
    }
    setSessionToken(data.token || null);
    onAuthenticated(data.user);
  } catch (err) {
    setError(
      err instanceof Error ? err.message : 'Sign in failed.'
    );
  } finally {
    setSubmitting(false);
  }
};

  
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();

  if (mode === 'complete-google') {
    await handleCompleteGoogleProfile(e);
    return;
  }

  if (mode === 'login') {
    await handleLogin(email, password);
    return;
  }

  if (!email.trim().toLowerCase().endsWith('@pau.edu.ng')) {
    setError('Please use your PAU student email address.');
    return;
  }

  setError(null);
  setSubmitting(true);

  try {
    try {
      const created = await registerEmailPasswordUser(email, password, {
        name,
        matricNumber,
        department,
        residency,
        hostelGender: residency === 'on-campus' ? hostelGender : undefined,
        hostelName: residency === 'on-campus' ? hostelName : undefined,
      });

      setSessionToken(null);
      const synced = await syncFirebaseUserWithServer(created);
      onAuthenticated(synced);
      return;
    } catch (fbErr: unknown) {
      const code =
        fbErr && typeof fbErr === 'object' && 'code' in fbErr
          ? String((fbErr as { code?: string }).code)
          : '';
      if (code !== 'auth/operation-not-allowed') {
        throw fbErr;
      }
    }

    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        email,
        password,
        matricNumber,
        department,
        residency,
        hostelGender: residency === 'on-campus' ? hostelGender : undefined,
        hostelName: residency === 'on-campus' ? hostelName : undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Registration failed.');
    }
    setSessionToken(data.token || null);
    onAuthenticated(data.user);
  } catch (err) {
    setError(
      err instanceof Error ? err.message : 'Registration failed.'
    );
  } finally {
    setSubmitting(false);
  }
};

  const handleOpenForgotPassword = () => {
    setMode('forgot-password');
    setForgotStep('request-email');
    setResetCode('');
    setRecoveryToken('');
    setNewPassword('');
    setConfirmNewPassword('');
    setForgotInfo(null);
    setPreviewOtpCode(null);
    setError(null);
  };

  const handleRequestResetCode = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!email.trim()) {
      setError('Please enter your account email address.');
      return;
    }
    setError(null);
    setForgotInfo(null);
    setPreviewOtpCode(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not send verification code.');
      }
      setForgotInfo(data.message || `Verification code sent to ${email.trim()}.`);
      if (data.delivery === 'preview' && data.previewCode) {
        setPreviewOtpCode(String(data.previewCode));
      }
      setForgotStep('verify-code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send verification code.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyResetCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/forgot-password/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          code: resetCode.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Verification failed.');
      }
      setRecoveryToken(String(data.recoveryToken || ''));
      setForgotStep('choose-action');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompleteRecovery = async (
    action: 'enter_app' | 'reset_password',
    e?: React.FormEvent
  ) => {
    if (e) e.preventDefault();
    setError(null);

    if (action === 'reset_password') {
      if (newPassword.length < 6) {
        setError('New password must be at least 6 characters long.');
        return;
      }
      if (newPassword !== confirmNewPassword) {
        setError('Passwords do not match. Use the eye icon to check both fields.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/forgot-password/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          recoveryToken,
          action,
          newPassword: action === 'reset_password' ? newPassword : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not complete account recovery.');
      }
      setSessionToken(data.token || null);
      onAuthenticated(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete account recovery.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelGoogleOnboarding = async () => {
    setPendingGoogleUser(null);
    setMode('login');
    setError(null);
    await signOut(auth).catch(() => {});
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-label="PrintHaus Account Sign In"
    >
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {mode === 'complete-google'
                ? 'Complete Your PAU Student Profile'
                : mode === 'forgot-password'
                  ? 'Recover Your PrintHaus Account'
                  : mode === 'login'
                    ? 'Sign in to PrintHaus'
                    : 'Create a PAU Student Account'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Pan-Atlantic University document printing and campus pickup portal
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sign in dialog"
            className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12">
          <form
            onSubmit={
              mode === 'forgot-password'
                ? (e) => {
                    if (forgotStep === 'request-email') {
                      void handleRequestResetCode(e);
                    } else if (forgotStep === 'verify-code') {
                      void handleVerifyResetCode(e);
                    } else if (forgotStep === 'new-password') {
                      void handleCompleteRecovery('reset_password', e);
                    } else {
                      e.preventDefault();
                    }
                  }
                : handleSubmit
            }
            className="md:col-span-7 p-6 space-y-4 border-b md:border-b-0 md:border-r border-slate-200"
          >
            {mode !== 'complete-google' && mode !== 'forgot-password' && (
              <>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleGoogleAuth}
                  className="w-full py-2.5 px-4 bg-white border border-slate-300 hover:border-slate-400 hover:bg-slate-50 text-slate-900 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2.5 cursor-pointer disabled:opacity-60"
                >
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="#4285F4"
                      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                    />
                  </svg>
                  <span>Continue with Google (Works on Any Phone)</span>
                </button>

                <div className="relative flex items-center py-1">
                  <div className="grow border-t border-slate-200" />
                  <span className="shrink mx-3 text-[11px] font-medium text-slate-400">
                    Or use account email
                  </span>
                  <div className="grow border-t border-slate-200" />
                </div>

                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('login');
                      setError(null);
                    }}
                    className={`flex-1 py-1.5 px-3 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      mode === 'login'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('register');
                      setError(null);
                    }}
                    className={`flex-1 py-1.5 px-3 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      mode === 'register'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Student Register
                  </button>
                </div>
              </>
            )}

            {mode === 'complete-google' && pendingGoogleUser && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-950 space-y-1">
                <p className="font-semibold">
                  Signed in as {pendingGoogleUser.email}
                </p>
                <p className="text-blue-800">
                  Save your PAU details once so your account and order history sync across any phone or laptop.
                </p>
              </div>
            )}

            {error && (
              <div className="p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg">
                {error}
              </div>
            )}

            {(mode === 'register' || mode === 'complete-google') && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    maxLength={120}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Kamsiyochukwu Obi"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Matric Number
                    </label>
                    <input
                      type="text"
                      required
                      minLength={2}
                      maxLength={40}
                      value={matricNumber}
                      onChange={(e) => setMatricNumber(e.target.value)}
                      placeholder="22120612944"
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Residency
                    </label>
                    <select
                      value={residency}
                      onChange={(e) => setResidency(e.target.value as ResidencyType)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-700"
                    >
                      <option value="off-campus">Off-Campus</option>
                      <option value="on-campus">On-Campus Hostel</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    PAU Programme & School
                  </label>
                  <select
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-700"
                  >
                    {PAU_SCHOOLS.map((group) => (
                      <optgroup key={group.school} label={group.school}>
                        {group.programmes.map((prog) => (
                          <option key={prog} value={prog}>
                            {prog}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                {residency === 'on-campus' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Hostel Category
                      </label>
                      <select
                        value={hostelGender}
                        onChange={(e) => {
                          const nextGender = e.target.value as HostelGender;
                          setHostelGender(nextGender);
                          setHostelName(
                            nextGender === 'male' ? PAU_MALE_HOSTELS[0] : PAU_FEMALE_HOSTELS[0]
                          );
                        }}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-700"
                      >
                        <option value="male">Male Hostels</option>
                        <option value="female">Female Hostels</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        On-Campus Hostel
                      </label>
                      <select
                        value={hostelName}
                        onChange={(e) => setHostelName(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-700"
                      >
                        {(hostelGender === 'male' ? PAU_MALE_HOSTELS : PAU_FEMALE_HOSTELS).map(
                          (hostel) => (
                            <option key={hostel} value={hostel}>
                              {hostel}
                            </option>
                          )
                        )}
                      </select>
                    </div>
                  </div>
                )}
              </>
            )}

            {mode === 'forgot-password' && (
              <div className="space-y-4">
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setError(null);
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to Sign In / Register</span>
                </button>

                {forgotStep === 'request-email' && (
                  <div className="space-y-3">
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700">
                      Enter your account email and we will send a 6-digit code so you can either set a new password or jump straight into PrintHaus.
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Email Address
                      </label>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="name@pau.edu.ng"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full py-2.5 px-4 bg-blue-800 hover:bg-blue-900 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60 cursor-pointer flex items-center justify-center gap-2"
                    >
                      <Mail className="w-4 h-4" />
                      <span>{submitting ? 'Sending code...' : 'Send Verification Code'}</span>
                    </button>
                  </div>
                )}

                {forgotStep === 'verify-code' && (
                  <div className="space-y-3">
                    {forgotInfo && (
                      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-950 space-y-1">
                        <p className="font-medium">{forgotInfo}</p>
                        {previewOtpCode && (
                          <p className="font-mono text-blue-900">
                            Preview code (configure RESEND_API_KEY for live email):{' '}
                            <span className="font-bold tracking-widest">{previewOtpCode}</span>
                          </p>
                        )}
                      </div>
                    )}
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        6-Digit Verification Code
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="\d{6}"
                        maxLength={6}
                        required
                        value={resetCode}
                        onChange={(e) => setResetCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="000000"
                        className="w-full px-3 py-2.5 text-center text-base font-mono tracking-[0.35em] border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={submitting || resetCode.length !== 6}
                      className="w-full py-2.5 px-4 bg-blue-800 hover:bg-blue-900 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60 cursor-pointer"
                    >
                      {submitting ? 'Verifying...' : 'Verify Code'}
                    </button>
                    <div className="flex items-center justify-between text-xs pt-1">
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => setForgotStep('request-email')}
                        className="text-slate-500 hover:text-slate-900 cursor-pointer"
                      >
                        Change email
                      </button>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => void handleRequestResetCode()}
                        className="text-blue-800 hover:text-blue-900 font-medium cursor-pointer"
                      >
                        Resend code
                      </button>
                    </div>
                  </div>
                )}

                {forgotStep === 'choose-action' && (
                  <div className="space-y-3">
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900 flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-700" />
                      <div>
                        <p className="font-semibold">Code verified for {email}</p>
                        <p className="mt-0.5 text-emerald-800">
                          Choose whether you want to change your password or enter PrintHaus right away.
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => {
                        setError(null);
                        setForgotStep('new-password');
                      }}
                      className="w-full p-3.5 text-left bg-white border border-slate-300 hover:border-blue-700 rounded-lg transition-colors flex items-center justify-between gap-3 cursor-pointer"
                    >
                      <div className="flex items-start gap-2.5">
                        <KeyRound className="w-4 h-4 text-blue-800 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-semibold text-slate-900">Change Password</p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Set a new password and sign in to your account
                          </p>
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
                    </button>

                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => void handleCompleteRecovery('enter_app')}
                      className="w-full py-2.5 px-4 bg-blue-800 hover:bg-blue-900 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60 cursor-pointer flex items-center justify-center gap-2"
                    >
                      <span>{submitting ? 'Signing in...' : 'Just Enter the App'}</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {forgotStep === 'new-password' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        New Password
                      </label>
                      <div className="relative">
                        <input
                          type={showNewPassword ? 'text' : 'password'}
                          required
                          minLength={6}
                          maxLength={128}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="At least 6 characters"
                          className="w-full pl-3 pr-10 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewPassword((prev) => !prev)}
                          aria-label={showNewPassword ? 'Hide new password' : 'Show new password'}
                          title={showNewPassword ? 'Hide password' : 'Show password'}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
                        >
                          {showNewPassword ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Confirm New Password
                      </label>
                      <div className="relative">
                        <input
                          type={showConfirmNewPassword ? 'text' : 'password'}
                          required
                          minLength={6}
                          maxLength={128}
                          value={confirmNewPassword}
                          onChange={(e) => setConfirmNewPassword(e.target.value)}
                          placeholder="Re-enter new password"
                          className="w-full pl-3 pr-10 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmNewPassword((prev) => !prev)}
                          aria-label={
                            showConfirmNewPassword
                              ? 'Hide confirm password'
                              : 'Show confirm password'
                          }
                          title={showConfirmNewPassword ? 'Hide password' : 'Show password'}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
                        >
                          {showConfirmNewPassword ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full py-2.5 px-4 bg-blue-800 hover:bg-blue-900 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60 cursor-pointer"
                    >
                      {submitting ? 'Updating...' : 'Save Password & Enter App'}
                    </button>

                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => void handleCompleteRecovery('enter_app')}
                      className="w-full py-2 px-4 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                    >
                      Skip changing password &amp; enter the app
                    </button>
                  </div>
                )}
              </div>
            )}

            {mode !== 'complete-google' && mode !== 'forgot-password' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={
                      mode === 'register'
                        ? 'name@pau.edu.ng'
                        : 'name@pau.edu.ng or staff email'
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-slate-700">Password</label>
                    <button
                      type="button"
                      onClick={handleOpenForgotPassword}
                      className="text-xs font-medium text-blue-800 hover:text-blue-900 hover:underline cursor-pointer"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter password"
                      className="w-full pl-3 pr-10 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      title={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              </>
            )}

            {mode !== 'forgot-password' && (
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 bg-blue-800 hover:bg-blue-900 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60 cursor-pointer"
              >
                {submitting
                  ? 'Saving...'
                  : mode === 'complete-google'
                    ? 'Save Profile & Enter Portal'
                    : mode === 'login'
                      ? 'Sign In'
                      : 'Create Student Account'}
              </button>
            )}

            {mode === 'complete-google' && (
              <button
                type="button"
                disabled={submitting}
                onClick={handleCancelGoogleOnboarding}
                className="w-full py-2 px-4 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                Use a different Google account
              </button>
            )}
          </form>

          <div className="md:col-span-5 p-6 bg-slate-50 flex flex-col justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-900">Quick Portal Access</p>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Select a PAU role account to explore the Student, Printing Staff, or Administrator workflow immediately.
              </p>

              <div className="mt-4 space-y-2">
                {DEMO_USERS.map((demo) => (
                  <button
                    key={demo.email}
                    type="button"
                    disabled={submitting}
                    onClick={() => handleLogin(demo.email, demo.pass)}
                    className="w-full text-left p-3 bg-white border border-slate-200 hover:border-blue-700 rounded-lg transition-colors group cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-900">{demo.label}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-700 transition-colors" />
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5">{demo.name}</p>
                    <p className="text-[11px] font-mono text-slate-400 mt-0.5">{demo.detail}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
