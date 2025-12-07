import { inject, Injectable } from '@angular/core';
import { getDownloadURL, ref, Storage, uploadBytes } from '@angular/fire/storage';
import { Timestamp } from '@angular/fire/firestore';
import { ApprovalAttachmentMetadata } from '../models/approvals';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 5;
const MAX_TOTAL_SIZE = 30 * 1024 * 1024; // 30MB

const DANGEROUS_EXTENSIONS = [
  'exe',
  'bat',
  'cmd',
  'sh',
  'js',
  'msi',
  'jar',
  'com',
  'scr',
  'cpl',
  'pif',
  'vbs',
  'vbe',
  'ps1',
];

const ALLOWED_EXTENSIONS = [
  'pdf',
  'csv',
  'xlsx',
  'xls',
  'doc',
  'docx',
  'ppt',
  'pptx',
  'txt',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'heic',
];

export interface AttachmentValidationResult {
  valid: boolean;
  errors: string[];
  files: File[];
  totalSize: number;
}

@Injectable({ providedIn: 'root' })
export class ApprovalAttachmentService {
  private storage = inject(Storage);

  readonly acceptExtensions = ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(',');

  validateFiles(files: File[]): AttachmentValidationResult {
    const errors: string[] = [];

    if (!files.length) {
      return { valid: false, errors: ['ファイルが選択されていません。'], files: [], totalSize: 0 };
    }

    if (files.length > MAX_FILES) {
      errors.push(`一度にアップロードできるのは最大 ${MAX_FILES} 件です。`);
    }

    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > MAX_TOTAL_SIZE) {
      errors.push('合計サイズは 30MB 以内にしてください。');
    }

    const safeFiles = files.filter((file) => {
      const ext = this.getExtension(file.name);
      if (DANGEROUS_EXTENSIONS.includes(ext)) {
        errors.push(`${file.name} は危険な拡張子のためアップロードできません。`);
        return false;
      }
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        errors.push(`${file.name} は許可されていない拡張子です。`);
        return false;
      }
      if (file.size > MAX_FILE_SIZE) {
        errors.push(`${file.name} は 10MB を超えています。`);
        return false;
      }
      return true;
    });

    return { valid: errors.length === 0, errors, files: safeFiles, totalSize };
  }

  async upload(requestId: string, files: File[], uploaderId: string, uploaderName: string): Promise<ApprovalAttachmentMetadata[]> {
    const uploaded: ApprovalAttachmentMetadata[] = [];

    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const extension = this.getExtension(file.name);
      const path = `approval_requests/${requestId}/${Date.now()}-${index}-${file.name}`;
      const fileRef = ref(this.storage, path);
      await uploadBytes(fileRef, file, { contentType: file.type });
      const downloadUrl = await getDownloadURL(fileRef);

      uploaded.push({
        id: `att-${Date.now()}-${index}`,
        name: file.name,
        size: file.size,
        contentType: file.type,
        extension,
        downloadUrl,
        uploadedAt: Timestamp.fromDate(new Date()),
        uploaderId,
        uploaderName,
        storagePath: path,
      });
    }

    return uploaded;
  }

  private getExtension(name: string): string {
    return name.split('.').pop()?.toLowerCase() ?? '';
  }
}