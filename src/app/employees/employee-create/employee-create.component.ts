import { CommonModule } from '@angular/common';
import { Component, OnInit, OnDestroy, inject, ChangeDetectorRef } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { Subject, switchMap, takeUntil, of } from 'rxjs';
import { ShahoEmployee, ShahoEmployeesService } from '../../app/services/shaho-employees.service';

@Component({
  selector: 'app-employee-create',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './employee-create.component.html',
  styleUrl: './employee-create.component.scss',
})
export class EmployeeCreateComponent implements OnInit, OnDestroy {
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private employeesService = inject(ShahoEmployeesService);
    private cdr = inject(ChangeDetectorRef);
    private destroy$ = new Subject<void>();

    editMode = true;
    submitAttempted = false;
    isEditMode = false;
    employeeId: string | null = null;
    isLoading = false;
  
    basicInfo = {
      employeeNo: '',
      name: '',
      kana: '',
      gender: '',
      birthDate: '',
      department: '',
      workPrefecture: '',
      myNumber: '',
      basicPensionNumber: '',
      address: '',
    };
  
    socialInsurance = {
      pensionOffice: '',
      officeName: '',
      standardMonthly: 0,
      healthCumulative: 0,
      healthInsuredNumber: '',
      pensionInsuredNumber: '',
      careSecondInsured: false,
      healthAcquisition: '',
      pensionAcquisition: '',
      childcareLeaveStart: '',
      childcareLeaveEnd: '',
      maternityLeaveStart: '',
      maternityLeaveEnd: '',
      exemption: false,
    };
  
    ngOnInit(): void {
      this.route.paramMap
        .pipe(
          takeUntil(this.destroy$),
          switchMap((params) => {
            const id = params.get('id');
            this.employeeId = id;
            this.isEditMode = !!id;
            
            if (!id) {
              // 新規作成モード
              return of(null);
            }
            
            // 編集モード: 既存データを読み込む
            this.isLoading = true;
            return this.employeesService.getEmployeeById(id);
          }),
        )
        .subscribe((employee) => {
          this.isLoading = false;
          if (employee) {
            this.loadEmployeeData(employee);
            this.cdr.detectChanges();
          }
        });
    }

    ngOnDestroy(): void {
      this.destroy$.next();
      this.destroy$.complete();
    }

    private loadEmployeeData(employee: ShahoEmployee) {
      // 性別のマッピング（データベースの「男」「女」をフォームの「男性」「女性」に変換）
      const normalizeGenderForForm = (gender?: string): string => {
        if (!gender) return '';
        const normalized = gender.trim();
        if (normalized === '男' || normalized === '男性' || normalized.toLowerCase() === 'male') {
          return '男性';
        }
        if (normalized === '女' || normalized === '女性' || normalized.toLowerCase() === 'female') {
          return '女性';
        }
        return normalized;
      };

      // 基本情報を設定
      this.basicInfo = {
        employeeNo: employee.employeeNo || '',
        name: employee.name || '',
        kana: employee.kana || '',
        gender: normalizeGenderForForm(employee.gender),
        birthDate: this.formatDateForInput(employee.birthDate) || '',
        department: employee.department || '',
        workPrefecture: employee.workPrefecture || '',
        myNumber: employee.personalNumber || '',
        basicPensionNumber: employee.basicPensionNumber || '',
        address: employee.address || '',
      };

      // 社会保険情報を設定
      this.socialInsurance = {
        pensionOffice: '',
        officeName: '',
        standardMonthly: employee.standardMonthly ?? 0,
        healthCumulative: employee.standardBonusAnnualTotal ?? 0,
        healthInsuredNumber: employee.healthInsuredNumber ?? employee.insuredNumber ?? '',
        pensionInsuredNumber: employee.pensionInsuredNumber ?? '',
        careSecondInsured: employee.careSecondInsured ?? false,
        healthAcquisition: this.formatDateForInput(employee.healthAcquisition) || '',
        pensionAcquisition: this.formatDateForInput(employee.pensionAcquisition) || '',
        childcareLeaveStart: this.formatDateForInput(employee.childcareLeaveStart) || '',
        childcareLeaveEnd: this.formatDateForInput(employee.childcareLeaveEnd) || '',
        maternityLeaveStart: this.formatDateForInput(employee.maternityLeaveStart) || '',
        maternityLeaveEnd: this.formatDateForInput(employee.maternityLeaveEnd) || '',
        exemption: employee.exemption ?? false,
      };
    }

    /**
     * 日付をYYYY-MM-DD形式に変換（input type="date"用）
     */
    private formatDateForInput(date: string | Date | undefined): string {
      if (!date) return '';
      
      // 既にYYYY-MM-DD形式の文字列の場合はそのまま返す
      if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return date;
      }
      
      // Dateオブジェクトまたは日付文字列を変換
      const d = typeof date === 'string' ? new Date(date) : date;
      if (isNaN(d.getTime())) return '';
      
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    toggleEditMode() {
      this.editMode = !this.editMode;
    }
  
    handleSaveDraft(form: NgForm) {
      this.submitAttempted = true;
      if (form.invalid) return;
      alert('一時保存しました（ダミー動作）');
    }
  
    handleProceedApproval(form: NgForm) {
      this.submitAttempted = true;
      if (form.invalid) return;
      alert('承認依頼画面へ遷移します（ダミー動作）');
    }
  }