# PrintHaus Firestore Security Specification

## 1. Data Invariants
1. A `/users/{userId}` document can only be created or read by the authenticated owner (`userId == request.auth.uid`) using a verified email (`email_verified == true`) or Firebase `password` provider, or by a trusted admin (`isAdmin()`, which strictly requires `email_verified == true` or `/admins/{uid}` membership).
2. A user creating their own `/users/{userId}` document MUST set `role == 'student'`, `roles == ['student']` (when present), and `status == 'active'`, preventing self-assigned privilege escalation (`staff` or `admin`).
3. A user updating their own `/users/{userId}` profile may ONLY modify mutable profile fields (`name`, `matricNumber`, `school`, `department`, `residency`, `hostelGender`, `hostelName`, `updatedAt`); `uid`, `email`, `role`, `roles`, `status`, and `createdAt` are immutable for non-admins.
4. An `/orders/{orderId}` document can only be created by an authenticated owner (`email_verified == true` or Firebase `password` provider) where `incoming().studentUid == request.auth.uid`, with an opaque immutable `qrReference` (up to 64 chars, no PII/URLs), and can only be read/listed by the owning student (`resource.data.studentUid == request.auth.uid`) or an admin (`isAdmin()`).
5. All `createdAt` and `updatedAt` timestamps MUST equal `request.time` (`serverTimestamp()`), and terminal order statuses (`collected`, `rejected`) lock further non-admin updates.

## 2. Adversarial Test Payloads ("Dirty Dozen")
1. **Unauthenticated profile create**: `request.auth == null` writing `/users/usr_1` -> `PERMISSION_DENIED`.
2. **Unverified email create**: `request.auth.token.email_verified == false` writing `/users/usr_1` -> `PERMISSION_DENIED`.
3. **Self-assigned admin role**: Authenticated student writes `/users/{uid}` with `role: 'admin'` -> `PERMISSION_DENIED`.
4. **UID spoofing on profile create**: Authenticated user `uid_A` writes `/users/uid_A` with `uid: 'uid_B'` or writes `/users/uid_B` -> `PERMISSION_DENIED`.
5. **Shadow ghost field on profile**: Valid profile plus `isVerified: true` -> `PERMISSION_DENIED`.
6. **Privilege escalation on profile update**: Owner updates `/users/{uid}` changing `role` to `'staff'` -> `PERMISSION_DENIED`.
7. **PII cross-user read**: Student `uid_A` reads `/users/uid_B` -> `PERMISSION_DENIED`.
8. **Blanket list scraping on users/orders**: Student lists `/users` or `/orders` without ownership boundary -> `PERMISSION_DENIED`.
9. **Resource poisoning (oversized ID/name)**: `orderId` > 128 chars or non-alphanumeric chars -> `PERMISSION_DENIED`.
10. **Order ownership spoofing**: Student `uid_A` creates `/orders/ord_1` with `studentUid: 'uid_B'` -> `PERMISSION_DENIED`.
11. **Client-forged timestamp**: Creating `/users/{uid}` or `/orders/{id}` with client `createdAt` string instead of `request.time` -> `PERMISSION_DENIED`.
12. **Terminal order tamper**: Non-admin updates `/orders/{id}` after `status == 'collected'` -> `PERMISSION_DENIED`.
