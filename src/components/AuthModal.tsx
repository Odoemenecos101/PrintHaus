import React, { useState } from 'react';
import { X, ArrowRight } from 'lucide-react';
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

export function AuthModal({ isOpen, initialMode = 'login', onClose, onAuthenticated }: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [matricNumber, setMatricNumber] = useState('');
  const [department, setDepartment] = useState('Computer Science');
  const [residency, setResidency] = useState<ResidencyType>('off-campus');
  const [hostelGender, setHostelGender] = useState<HostelGender>('male');
  const [hostelName, setHostelName] = useState<string>(PAU_MALE_HOSTELS[0]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleLogin = async (loginEmail: string, loginPass: string) => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPass }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Sign in failed.');
        return;
      }
      onAuthenticated(data.user);
    } catch {
      setError('Unable to reach PrintHaus server.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'login') {
      await handleLogin(email, password);
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          password,
          matricNumber,
          school: getSchoolForProgramme(department),
          department,
          residency,
          hostelGender: residency === 'on-campus' ? hostelGender : undefined,
          hostelName: residency === 'on-campus' ? hostelName : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Registration failed.');
        return;
      }
      onAuthenticated(data.user);
    } catch {
      setError('Unable to reach PrintHaus server.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-label="PrintHaus Account Sign In"
    >
      <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {mode === 'login' ? 'Sign in to PrintHaus' : 'Create a PAU Student Account'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Pan-Atlantic University document printing and campus pickup portal
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sign in dialog"
            className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12">
          <form onSubmit={handleSubmit} className="md:col-span-7 p-6 space-y-4 border-b md:border-b-0 md:border-r border-slate-200">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
                className={`flex-1 py-1.5 px-3 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  mode === 'login' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
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
                className={`flex-1 py-1.5 px-3 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  mode === 'register' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Student Register
              </button>
            </div>

            {error && (
              <div className="p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg">
                {error}
              </div>
            )}

            {mode === 'register' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Kamsiyochukwu Obi"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Matric Number</label>
                    <input
                      type="text"
                      required
                      value={matricNumber}
                      onChange={(e) => setMatricNumber(e.target.value)}
                      placeholder="22120612944"
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Residency</label>
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

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Email Address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@pau.edu.ng"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 bg-blue-800 hover:bg-blue-900 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60 cursor-pointer"
            >
              {submitting ? 'Authenticating...' : mode === 'login' ? 'Sign In' : 'Create Student Account'}
            </button>
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
