import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  User as FirebaseUser,
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  signOut,
} from 'firebase/auth';
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import {
  HostelGender,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  PrintOrder,
  ResidencyType,
  UserAccount,
  UserRole,
  getPrimaryRole,
  getSchoolForProgramme,
  isValidPauEmail,
  normalizeRoles,
} from './types/printhaus';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();

function timestampToIso(value: unknown): string {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return new Date().toISOString();
}

export async function fetchFirestoreUserProfile(uid: string): Promise<UserAccount | null> {
  const path = `users/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    const data = snap.data();
    const rawRoles = Array.isArray(data.roles)
      ? (data.roles as UserRole[])
      : undefined;
    const roles = normalizeRoles(
      rawRoles,
      data.role === 'staff' || data.role === 'admin' ? data.role : 'student'
    );
    return {
      id: String(data.uid || uid),
      name: String(data.name || ''),
      email: String(data.email || ''),
      phone: data.phone ? String(data.phone) : undefined,
      matricNumber: String(data.matricNumber || ''),
      school: String(data.school || ''),
      department: String(data.department || ''),
      residency: data.residency === 'on-campus' ? 'on-campus' : 'off-campus',
      hostelGender:
        data.hostelGender === 'male' || data.hostelGender === 'female'
          ? data.hostelGender
          : undefined,
      hostelName: data.hostelName ? String(data.hostelName) : undefined,
      role: getPrimaryRole(roles),
      roles,
      status: data.status === 'suspended' ? 'suspended' : 'active',
      createdAt: timestampToIso(data.createdAt),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export class MissingFirestoreProfileError extends Error {
  firebaseUser: FirebaseUser;
  constructor(firebaseUser: FirebaseUser) {
    super('Your PrintHaus profile needs to be completed before continuing.');
    this.name = 'MissingFirestoreProfileError';
    this.firebaseUser = firebaseUser;
  }
}

export async function loginWithEmailPassword(
  email: string,
  password: string
): Promise<UserAccount> {
  const credential = await signInWithEmailAndPassword(
    auth,
    email.trim(),
    password
  );

  const profile = await fetchFirestoreUserProfile(credential.user.uid);

  if (!profile) {
    throw new MissingFirestoreProfileError(credential.user);
  }

  return profile;
}


export interface CreateFirestoreProfileInput {
  name: string;
  matricNumber: string;
  department: string;
  residency: ResidencyType;
  hostelGender?: HostelGender;
  hostelName?: string;
}

export async function createFirestoreUserProfile(
  firebaseUser: FirebaseUser,
  input: CreateFirestoreProfileInput
): Promise<UserAccount> {
  const uid = firebaseUser.uid;
  const path = `users/${uid}`;
  const cleanName = input.name.trim().slice(0, 120) || firebaseUser.displayName?.slice(0, 120) || 'PAU Student';
  const cleanEmail = (firebaseUser.email || '').trim().toLowerCase().slice(0, 160);
  const rawMatric = input.matricNumber.trim().slice(0, 40);
  const cleanMatric = rawMatric.length >= 2 ? rawMatric : 'PAU-NEW';
  const cleanDept = (input.department.trim() || 'Computer Science').slice(0, 120);
  const cleanSchool = (getSchoolForProgramme(cleanDept) || 'School of Science and Technology').slice(0, 120);

  const payload: Record<string, unknown> = {
    uid,
    name: cleanName,
    email: cleanEmail,
    matricNumber: cleanMatric,
    school: cleanSchool,
    department: cleanDept,
    residency: input.residency === 'on-campus' ? 'on-campus' : 'off-campus',
    role: 'student',
    roles: ['student'],
    status: 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (input.residency === 'on-campus') {
    payload.hostelGender = input.hostelGender === 'female' ? 'female' : 'male';
    if (input.hostelName && input.hostelName.trim()) {
      payload.hostelName = input.hostelName.trim().slice(0, 120);
    }
  }

  try {
    await setDoc(doc(db, 'users', uid), payload);
    return {
      id: uid,
      name: cleanName,
      email: cleanEmail,
      matricNumber: cleanMatric,
      school: cleanSchool,
      department: cleanDept,
      residency: payload.residency as ResidencyType,
      hostelGender: payload.hostelGender as HostelGender | undefined,
      hostelName: payload.hostelName as string | undefined,
      role: 'student',
      roles: ['student'],
      status: 'active',
      createdAt: new Date().toISOString(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function registerEmailPasswordUser(
  email: string,
  password: string,
  input: CreateFirestoreProfileInput
): Promise<UserAccount> {
  const cleanEmail = email.trim().toLowerCase();
  if (!isValidPauEmail(cleanEmail)) {
    throw new Error('Please enter a valid PAU student email address ending in @pau.edu.ng.');
  }
  const cleanName = input.name.trim();

  try {
    const credential = await createUserWithEmailAndPassword(
      auth,
      cleanEmail,
      password
    );

    if (cleanName) {
      await updateProfile(credential.user, {
        displayName: cleanName,
      });
    }

    return createFirestoreUserProfile(credential.user, input);
  } catch (err: unknown) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: string }).code)
        : '';

    if (code === 'auth/email-already-in-use') {
      // Recover incomplete registrations where Firebase Auth succeeded previously but Firestore profile failed
      try {
        const existingCred = await signInWithEmailAndPassword(auth, cleanEmail, password);
        const existingProfile = await fetchFirestoreUserProfile(existingCred.user.uid);
        if (existingProfile) {
          await signOut(auth);
          throw new Error('This PAU email is already registered. Please sign in instead.');
        }
        if (cleanName) {
          await updateProfile(existingCred.user, {
            displayName: cleanName,
          }).catch(() => {});
        }
        return createFirestoreUserProfile(existingCred.user, input);
      } catch (recoveryErr: unknown) {
        const recCode =
          recoveryErr && typeof recoveryErr === 'object' && 'code' in recoveryErr
            ? String((recoveryErr as { code?: string }).code)
            : '';
        if (
          [
            'auth/invalid-credential',
            'auth/wrong-password',
            'auth/too-many-requests',
            'auth/user-disabled',
          ].includes(recCode)
        ) {
          throw new Error(
            'An account with this email already exists. Switch to Sign In or use Forgot Password.'
          );
        }
        throw recoveryErr;
      }
    }

    throw err;
  }
}


export async function syncOrderToFirestore(
  firebaseUid: string,
  order: PrintOrder
): Promise<void> {
  const path = `orders/${order.id}`;
  const orderRef = doc(db, 'orders', order.id);

  try {
    const existingSnap = await getDoc(orderRef);
    if (!existingSnap.exists()) {
      const itemsSummary =
        order.items && order.items.length > 0
          ? order.items
              .map((it) => `${it.recipientLabel}: ${it.fileName} (${it.pageCount}p x${it.specs.copies})`)
              .join(' | ')
              .slice(0, 500)
          : `${order.fileName} (${order.pageCount}p)`.slice(0, 500);

      const createPayload: Record<string, unknown> = {
        id: order.id.slice(0, 128),
        orderCode: order.orderCode.slice(0, 32),
        collectionCode: order.collectionCode.slice(0, 32),
        qrReference: order.qrReference.slice(0, 64),
        studentUid: firebaseUid.slice(0, 128),
        studentId: order.studentId.slice(0, 128),
        studentName: order.studentName.slice(0, 120),
        studentEmail: (order.studentEmail || 'student@pau.edu.ng').slice(0, 160),
        matricNumber: (order.matricNumber || 'PAU-STD').slice(0, 40),
        fileName: order.fileName.slice(0, 200),
        totalPages: Math.max(1, Number(order.pricingBreakdown.totalPages) || 1),
        totalDocuments: Math.max(1, Number(order.pricingBreakdown.totalDocuments ?? 1) || 1),
        totalAmount: Math.max(0, Number(order.pricingBreakdown.totalAmount) || 0),
        pickupVenue: order.pickupVenue.slice(0, 120),
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        paymentReference: order.paymentReference.slice(0, 64),
        status: order.status,
        itemsSummary,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      if (order.pickupShelf) {
        createPayload.pickupShelf = order.pickupShelf.slice(0, 64);
      }
      if (order.pickupSlot) {
        createPayload.pickupSlot = order.pickupSlot.slice(0, 120);
      }
      if (order.pickupEta) {
        createPayload.pickupEta = order.pickupEta.slice(0, 120);
      }
      if (order.deliveryStaffName) {
        createPayload.deliveryStaffName = order.deliveryStaffName.slice(0, 120);
      }
      if (order.deliveryStaffPhone) {
        createPayload.deliveryStaffPhone = order.deliveryStaffPhone.slice(0, 32);
      }

      await setDoc(orderRef, createPayload);
    } else {
      const existingData = existingSnap.data();
      if (['collected', 'rejected'].includes(String(existingData.status))) {
        return;
      }
      const updatePayload: Record<string, unknown> = {
        status: order.status,
        paymentStatus: order.paymentStatus,
        updatedAt: serverTimestamp(),
      };
      if (order.pickupShelf) {
        updatePayload.pickupShelf = order.pickupShelf.slice(0, 64);
      }
      if (order.pickupEta) {
        updatePayload.pickupEta = order.pickupEta.slice(0, 120);
      }
      await updateDoc(orderRef, updatePayload);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function fetchOrdersFromFirestore(firebaseUid: string): Promise<PrintOrder[]> {
  const path = 'orders';
  try {
    const q = query(collection(db, path), where('studentUid', '==', firebaseUid));
    const snap = await getDocs(q);
    const results: PrintOrder[] = [];

    snap.forEach((docSnap) => {
      const d = docSnap.data();
      const createdAt = timestampToIso(d.createdAt);
      const updatedAt = timestampToIso(d.updatedAt);
      const status = (d.status || 'order_received') as OrderStatus;
      const paymentMethod = (d.paymentMethod || 'paystack_card') as PaymentMethod;
      const paymentStatus = (d.paymentStatus || 'confirmed') as PaymentStatus;
      const totalPages = Number(d.totalPages) || 1;
      const totalDocuments = Number(d.totalDocuments) || 1;
      const totalAmount = Number(d.totalAmount) || 0;

      results.push({
        id: String(d.id || docSnap.id),
        orderCode: String(d.orderCode || ''),
        collectionCode: String(d.collectionCode || ''),
        qrReference: String(d.qrReference || d.collectionCode || d.orderCode || ''),
        studentId: String(d.studentId || firebaseUid),
        studentName: String(d.studentName || ''),
        studentEmail: String(d.studentEmail || ''),
        matricNumber: String(d.matricNumber || ''),
        documentId: String(d.id || docSnap.id),
        fileName: String(d.fileName || ''),
        fileSize: 0,
        fileType: 'application/pdf',
        pageCount: totalPages,
        specs: {
          copies: totalDocuments,
          colorMode: 'bw',
          sided: 'single',
          binding: 'none',
          lamination: false,
          urgent: false,
          notes: d.itemsSummary ? String(d.itemsSummary) : '',
        },
        pricingBreakdown: {
          totalDocuments,
          totalPages,
          perPageRate: 200,
          printCost: totalAmount,
          finishingCost: 0,
          urgentFee: 0,
          discountAmount: 0,
          discountReason: null,
          totalAmount,
          partnerCost: 0,
          packagingCost: 0,
          operatingCost: 0,
          netContribution: 0,
        },
        paymentMethod,
        paymentStatus,
        paymentReference: String(d.paymentReference || ''),
        status,
        statusHistory: [
          {
            status,
            label: status === 'ready_for_collection' ? 'Ready for Pickup' : status.replace(/_/g, ' '),
            note: d.itemsSummary ? String(d.itemsSummary) : 'Synced from PrintHaus Cloud Account.',
            actor: 'PrintHaus Cloud',
            timestamp: updatedAt,
          },
        ],
        qualityChecklist: {
          correctDocument: status === 'ready_for_collection' || status === 'collected',
          correctCopies: status === 'ready_for_collection' || status === 'collected',
          correctPageCount: status === 'ready_for_collection' || status === 'collected',
          correctFormat: status === 'ready_for_collection' || status === 'collected',
          printQuality: status === 'ready_for_collection' || status === 'collected',
          packagedAndLabeled: status === 'ready_for_collection' || status === 'collected',
        },
        assignedPartnerId: 'ptr_primary',
        assignedPartnerName: 'Lekki Academic Press (Primary)',
        pickupVenue: String(d.pickupVenue || 'Security Post in TYD'),
        pickupSlot: String(d.pickupSlot || 'Anytime during operating hours'),
        pickupShelf: d.pickupShelf ? String(d.pickupShelf) : null,
        pickupEta: d.pickupEta ? String(d.pickupEta) : null,
        deliveryStaffName: d.deliveryStaffName ? String(d.deliveryStaffName) : null,
        deliveryStaffPhone: d.deliveryStaffPhone ? String(d.deliveryStaffPhone) : null,
        rejectionReason: null,
        createdAt,
        updatedAt,
      });
    });

    return results.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function syncFirebaseUserWithServer(
  profile: UserAccount,
  overrideIdToken?: string
): Promise<UserAccount> {
  const token = overrideIdToken || (await auth.currentUser?.getIdToken().catch(() => null));
  if (!token) {
    return {
      ...profile,
      roles: normalizeRoles(profile.roles, profile.role),
    };
  }

  const res = await fetch('/api/auth/firebase-sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      name: profile.name,
      matricNumber: profile.matricNumber,
      school: profile.school,
      department: profile.department,
      residency: profile.residency,
      hostelGender: profile.hostelGender,
      hostelName: profile.hostelName,
    }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(
      errData.error ||
        (res.status === 403
          ? 'This account is deactivated or not permitted to register.'
          : 'Could not complete server account setup. Please try again.')
    );
  }

  const data = await res.json();
  if (data.user) {
    return data.user as UserAccount;
  }

  return {
    ...profile,
    roles: normalizeRoles(profile.roles, profile.role),
  };
}
