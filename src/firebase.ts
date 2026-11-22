import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  User as FirebaseUser,
  getAuth,
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
  getSchoolForProgramme,
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
    return {
      id: String(data.uid || uid),
      name: String(data.name || ''),
      email: String(data.email || ''),
      matricNumber: String(data.matricNumber || ''),
      school: String(data.school || ''),
      department: String(data.department || ''),
      residency: data.residency === 'on-campus' ? 'on-campus' : 'off-campus',
      hostelGender:
        data.hostelGender === 'male' || data.hostelGender === 'female'
          ? data.hostelGender
          : undefined,
      hostelName: data.hostelName ? String(data.hostelName) : undefined,
      role:
        data.role === 'staff' || data.role === 'admin' ? data.role : 'student',
      status: data.status === 'suspended' ? 'suspended' : 'active',
      createdAt: timestampToIso(data.createdAt),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
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
  const cleanEmail = (firebaseUser.email || '').trim().slice(0, 160);
  const cleanMatric = (input.matricNumber.trim() || 'PAU-NEW').slice(0, 40);
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
      status: 'active',
      createdAt: new Date().toISOString(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
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
        pickupSlot: 'Anytime during operating hours',
        pickupShelf: d.pickupShelf ? String(d.pickupShelf) : null,
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

export async function syncFirebaseUserWithServer(profile: UserAccount): Promise<UserAccount> {
  try {
    const res = await fetch('/api/auth/firebase-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid: profile.id,
        name: profile.name,
        email: profile.email,
        matricNumber: profile.matricNumber,
        school: profile.school,
        department: profile.department,
        residency: profile.residency,
        hostelGender: profile.hostelGender,
        hostelName: profile.hostelName,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.user) return data.user as UserAccount;
    }
  } catch {
    // Fallback to Firestore profile directly if backend sync is temporarily unavailable
  }
  return profile;
}
