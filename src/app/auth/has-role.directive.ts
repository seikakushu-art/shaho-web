import { Directive, Input, TemplateRef, ViewContainerRef, inject, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { AuthService } from './auth.service';
import { RoleKey } from '../models/roles';

@Directive({
  selector: '[appHasRole]',
  standalone: true,
})
export class HasRoleDirective implements OnDestroy {
  private templateRef = inject(TemplateRef<any>);
  private viewContainer = inject(ViewContainerRef);
  private authService = inject(AuthService);
  private subscription?: Subscription;

  private requiredRoles: RoleKey[] = [];

  @Input()
  set appHasRole(role: RoleKey | RoleKey[]) {
    this.requiredRoles = Array.isArray(role) ? role : [role];
    this.subscribe();
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  private subscribe() {
    this.subscription?.unsubscribe();
    this.subscription = this.authService.userRoles$.subscribe((roles) => {
      const hasRole = this.requiredRoles.some((required) => roles.includes(required));
      this.viewContainer.clear();
      if (hasRole) {
        this.viewContainer.createEmbeddedView(this.templateRef);
      }
    });
  }
}