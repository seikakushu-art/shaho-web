import * as admin from 'firebase-admin';

/**
 * 標準報酬月額の新フィールドへの移行スクリプト。
 *
 * 前提:
 *  - GOOGLE_APPLICATION_CREDENTIALS でサービスアカウントJSONを指定。
 *  - 対象コレクション: shaho_employees
 *
 * 実装内容:
 *  - standardMonthly を healthStandardMonthly にコピー（既に値がある場合は既存を尊重）。
 *  - welfareStandardMonthly が未設定の場合は healthStandardMonthly を暫定コピー。
 */
async function migrate() {
  if (admin.apps.length === 0) {
    admin.initializeApp();
  }
  const db = admin.firestore();
  const snapshot = await db.collection('shaho_employees').get();

  const batch = db.batch();
  snapshot.forEach((doc: admin.firestore.QueryDocumentSnapshot) => {
    const data = doc.data();
    const health = data['healthStandardMonthly'] ?? data['standardMonthly'];
    const welfare = data['welfareStandardMonthly'] ?? health;

    const update: Record<string, number | null> = {};
    if (health !== undefined) {
      update['healthStandardMonthly'] = health ?? null;
    }
    if (health !== undefined && data['standardMonthly'] === undefined) {
      update['standardMonthly'] = health ?? null;
    }
    if (welfare !== undefined) {
      update['welfareStandardMonthly'] = welfare ?? null;
    }

    if (Object.keys(update).length > 0) {
      batch.set(doc.ref, update, { merge: true });
    }
  });

  await batch.commit();
  console.log(`migrated ${snapshot.size} employees`);
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});