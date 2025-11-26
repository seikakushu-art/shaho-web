import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-employee-import',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './employee-import.component.html',
  styleUrl: './employee-import.component.scss',
})
export class EmployeeImportComponent {}