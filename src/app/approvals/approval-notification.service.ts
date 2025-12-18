import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, map, Observable, switchMap, of } from 'rxjs';
import { ApprovalNotification } from '../models/approvals';
import { Firestore, collection, collectionData, doc, setDoc, deleteDoc, query, where, orderBy, limit, Timestamp } from '@angular/fire/firestore';

interface FirestoreNotification {
  id: string;
  requestId: string;
  recipientId: string;
  message: string;
  unread: boolean;
  createdAt: Timestamp;
  type: 'info' | 'success' | 'warning';
}

@Injectable({ providedIn: 'root' })
export class ApprovalNotificationService {
  private firestore = inject(Firestore);
  private notificationsRef = collection(this.firestore, 'approval_notifications');
  private notificationsSubject = new BehaviorSubject<ApprovalNotification[]>([]);
  readonly notifications$ = this.notificationsSubject.asObservable();

  constructor() {
    // Firestoreから通知を読み込む
    this.loadNotifications();
  }

  private loadNotifications() {
    // 全通知を読み込む（recipientIdでフィルタリングは呼び出し側で行う）
    const q = query(this.notificationsRef, orderBy('createdAt', 'desc'), limit(100));
    collectionData(q, { idField: 'id' }).subscribe((notifications: any[]) => {
      const converted = notifications
        .map((n) => {
          try {
            return this.convertFromFirestore(n as FirestoreNotification);
          } catch (error) {
            console.error('Failed to convert notification:', n, error);
            return null;
          }
        })
        .filter((n): n is ApprovalNotification => n !== null);
      this.notificationsSubject.next(converted);
    });
  }

  private convertFromFirestore(fsNotif: FirestoreNotification): ApprovalNotification {
    return {
      id: fsNotif.id,
      requestId: fsNotif.requestId,
      recipientId: fsNotif.recipientId,
      message: fsNotif.message,
      unread: fsNotif.unread,
      createdAt: fsNotif.createdAt?.toDate() ?? new Date(),
      type: fsNotif.type,
    };
  }

  private convertToFirestore(notif: ApprovalNotification): FirestoreNotification {
    return {
      id: notif.id,
      requestId: notif.requestId,
      recipientId: notif.recipientId,
      message: notif.message,
      unread: notif.unread,
      createdAt: Timestamp.fromDate(notif.createdAt),
      type: notif.type,
    };
  }

  async push(notification: ApprovalNotification) {
    const current = this.notificationsSubject.value;
    this.notificationsSubject.next([notification, ...current]);
    
    // Firestoreに保存
    const docRef = doc(this.notificationsRef, notification.id);
    const firestoreData = this.convertToFirestore(notification);
    await setDoc(docRef, firestoreData);
  }

  async pushBatch(notifications: ApprovalNotification[]) {
    const current = this.notificationsSubject.value;
    this.notificationsSubject.next([...notifications, ...current]);
    
    // Firestoreに一括保存
    const promises = notifications.map((notification) => {
      const docRef = doc(this.notificationsRef, notification.id);
      const firestoreData = this.convertToFirestore(notification);
      return setDoc(docRef, firestoreData);
    });
    await Promise.all(promises);
  }

  async markAsRead(notificationId: string) {
    const updated = this.notificationsSubject.value.map((notification) =>
      notification.id === notificationId ? { ...notification, unread: false } : notification,
    );
    this.notificationsSubject.next(updated);
    
    // Firestoreに保存
    const notification = updated.find((n) => n.id === notificationId);
    if (notification) {
      const docRef = doc(this.notificationsRef, notificationId);
      const firestoreData = this.convertToFirestore(notification);
      await setDoc(docRef, firestoreData);
    }
  }

  unreadCountFor(recipientId: string): Observable<number> {
    return this.notifications$.pipe(
      map((notifications) =>
        notifications.filter((notification) => notification.recipientId === recipientId && notification.unread)
          .length,
      ),
    );
  }

  async delete(notificationId: string) {
    const updated = this.notificationsSubject.value.filter((notification) => notification.id !== notificationId);
    this.notificationsSubject.next(updated);
    
    // Firestoreから削除
    const docRef = doc(this.notificationsRef, notificationId);
    await deleteDoc(docRef);
  }

  async deleteBatch(notificationIds: string[]) {
    const updated = this.notificationsSubject.value.filter((notification) => !notificationIds.includes(notification.id));
    this.notificationsSubject.next(updated);
    
    // Firestoreから一括削除
    const promises = notificationIds.map((notificationId) => {
      const docRef = doc(this.notificationsRef, notificationId);
      return deleteDoc(docRef);
    });
    await Promise.all(promises);
  }

  async deleteAllForRecipient(recipientId: string) {
    const notifications = this.notificationsSubject.value;
    const targetNotifications = notifications.filter((notification) => notification.recipientId?.toLowerCase() === recipientId.toLowerCase());
    const notificationIds = targetNotifications.map((n) => n.id);
    
    if (notificationIds.length === 0) return;
    
    await this.deleteBatch(notificationIds);
  }
}