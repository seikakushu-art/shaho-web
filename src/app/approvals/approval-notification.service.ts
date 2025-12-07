import { Injectable } from '@angular/core';
import { BehaviorSubject, map, Observable } from 'rxjs';
import { ApprovalNotification } from '../models/approvals';

@Injectable({ providedIn: 'root' })
export class ApprovalNotificationService {
  private notificationsSubject = new BehaviorSubject<ApprovalNotification[]>([]);
  readonly notifications$ = this.notificationsSubject.asObservable();

  push(notification: ApprovalNotification) {
    const current = this.notificationsSubject.value;
    this.notificationsSubject.next([notification, ...current]);
  }

  pushBatch(notifications: ApprovalNotification[]) {
    const current = this.notificationsSubject.value;
    this.notificationsSubject.next([...notifications, ...current]);
  }

  markAsRead(notificationId: string) {
    const updated = this.notificationsSubject.value.map((notification) =>
      notification.id === notificationId ? { ...notification, unread: false } : notification,
    );
    this.notificationsSubject.next(updated);
  }

  unreadCountFor(recipientId: string): Observable<number> {
    return this.notifications$.pipe(
      map((notifications) =>
        notifications.filter((notification) => notification.recipientId === recipientId && notification.unread)
          .length,
      ),
    );
  }
}