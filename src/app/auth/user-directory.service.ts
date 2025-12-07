import { inject, Injectable } from '@angular/core';
import {
  collection,
  collectionData,
  deleteDoc,
  doc,
  Firestore,
  getDoc,
  setDoc,
  Timestamp,
} from '@angular/fire/firestore';
import { from, map, Observable, of, switchMap } from 'rxjs';
import { RoleKey } from '../models/roles';

export interface AppUser {
  id?: string;
  email: string;
  displayName?: string;
  roles: RoleKey[];
  disabled?: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

@Injectable({ providedIn: 'root' })
export class UserDirectoryService {
  private firestore = inject(Firestore);
  private collectionRef = collection(this.firestore, 'app_users');

  getUsers(): Observable<AppUser[]> {
    return collectionData(this.collectionRef, { idField: 'id' }) as Observable<AppUser[]>;
  }

  getUserByEmail(email: string): Observable<AppUser | undefined> {
    const normalizedEmail = email.toLowerCase();
    const docRef = doc(this.collectionRef, normalizedEmail);

    return from(getDoc(docRef)).pipe(
      map((snapshot) =>
        snapshot.exists()
          ? ({ id: snapshot.id, ...(snapshot.data() as Omit<AppUser, 'id'>) } as AppUser)
          : undefined,
      ),
    );
  }

  ensureUser(email: string, displayName?: string): Observable<AppUser> {
    const normalizedEmail = email.toLowerCase();
    const docRef = doc(this.collectionRef, normalizedEmail);

    return from(getDoc(docRef)).pipe(
      switchMap((snapshot) => {
        if (snapshot.exists()) {
          return of({ id: snapshot.id, ...(snapshot.data() as Omit<AppUser, 'id'>) } as AppUser);
        }

        const newUser: AppUser = {
          id: normalizedEmail,
          email: normalizedEmail,
          displayName: displayName || normalizedEmail,
          roles: [RoleKey.Guest],
        };

        return from(setDoc(docRef, newUser)).pipe(map(() => newUser));
      }),
    );
  }

  saveUser(user: AppUser): Promise<void> {
    const normalizedEmail = user.email.toLowerCase();
    const docRef = doc(this.collectionRef, normalizedEmail);
    const payload: AppUser = {
      ...user,
      email: normalizedEmail,
      roles: user.roles?.length ? user.roles : [RoleKey.Guest],
    };
    delete payload.id;
    return setDoc(docRef, payload, { merge: true });
  }

  async createUser(user: AppUser): Promise<void> {
    await this.saveUser(user);
  }

  updateRoles(email: string, roles: RoleKey[]): Promise<void> {
    const normalizedEmail = email.toLowerCase();
    const docRef = doc(this.collectionRef, normalizedEmail);
    return setDoc(docRef, { roles }, { merge: true });
  }

  deleteUser(email: string): Promise<void> {
    const normalizedEmail = email.toLowerCase();
    const docRef = doc(this.collectionRef, normalizedEmail);
    return deleteDoc(docRef);
  }
}