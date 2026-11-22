import fs from 'fs';
import path from 'path';
import { App, cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { DecodedIdToken, getAuth } from 'firebase-admin/auth';

interface FirebaseAppletConfig {
  projectId: string;
  firestoreDatabaseId?: string;
}

function loadAppletConfig(): FirebaseAppletConfig {
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as FirebaseAppletConfig;
  } catch {
    return { projectId: process.env.FIREBASE_PROJECT_ID || 'clever-transducer-jk4jk' };
  }
}

let cachedApp: App | null = null;

export function getFirebaseAdminApp(): App {
  if (cachedApp) return cachedApp;
  if (getApps().length > 0) {
    cachedApp = getApp();
    return cachedApp;
  }

  const appletConfig = loadAppletConfig();
  const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();

  if (serviceAccountRaw) {
    const parsed = JSON.parse(serviceAccountRaw);
    cachedApp = initializeApp({
      credential: cert(parsed),
      projectId: parsed.project_id || appletConfig.projectId,
    });
    return cachedApp;
  }

  // Project-ID-only initialization supports verifyIdToken(token) on any Firebase project
  // without requiring IAM roles or service account key files.
  cachedApp = initializeApp({
    projectId: appletConfig.projectId,
  });
  return cachedApp;
}

export async function verifyFirebaseBearerToken(idToken: string): Promise<DecodedIdToken> {
  const adminApp = getFirebaseAdminApp();
  return getAuth(adminApp).verifyIdToken(idToken);
}
