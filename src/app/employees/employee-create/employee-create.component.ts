import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-employee-create',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './employee-create.component.html',
  styleUrl: './employee-create.component.scss',
})
export class EmployeeCreateComponent {
    editMode = true;
    submitAttempted = false;
    showStandardPay = false;
    showBonusCalc = false;
  
    basicInfo = {
      employeeNo: 'E202510',
      name: '',
      kana: '',
      gender: '女性',
      birthDate: '',
      department: '',
      workPrefecture: '東京都',
      hireDate: '',
      employmentType: '正社員',
      email: '',
      phone: '',
    };
  
    socialInsurance = {
      healthType: '協会けんぽ',
      healthNumber: '12345678',
      pensionOffice: '12-34567',
      officeName: '社会保険労務オフィス東京',
      standardMonthly: 420000,
      careSecondInsured: false,
      healthAcquisition: '',
      pensionAcquisition: '',
      exemption: false,
    };
  
    standardPay = {
      periodStart: '2025-04',
      periodEnd: '2025-06',
      april: { amount: 420000, days: 20 },
      may: { amount: 415000, days: 20 },
      june: { amount: 430000, days: 21 },
      average: 421667,
      newStandard: 422000,
      oldStandard: 410000,
    };
  
    bonusCalc = {
      paidOn: '',
      fiscalYear: 2025,
      total: 0,
      standardHealth: 0,
      standardPension: 0,
      healthCumulative: 0,
    };
  
    toggleEditMode() {
      this.editMode = !this.editMode;
    }
  
    recalcCareFlag() {
      if (!this.basicInfo.birthDate) return;
      const birthDate = new Date(this.basicInfo.birthDate);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const m = today.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      this.socialInsurance.careSecondInsured = age >= 40 && age < 65;
    }
  
    recalcStandardPay() {
      const total =
        this.standardPay.april.amount +
        this.standardPay.may.amount +
        this.standardPay.june.amount;
      this.standardPay.average = Math.round(total / 3);
      this.standardPay.newStandard = Math.round(this.standardPay.average / 1000) * 1000;
      this.socialInsurance.standardMonthly = this.standardPay.newStandard;
    }
  
    recalcBonus() {
      const base = this.bonusCalc.total;
      this.bonusCalc.standardHealth = Math.max(0, Math.round(base * 0.95));
      this.bonusCalc.standardPension = Math.max(0, Math.round(base * 0.93));
      this.bonusCalc.healthCumulative = Math.max(
        0,
        this.bonusCalc.standardHealth + 280000,
      );
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