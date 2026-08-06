export type SignConsentValue = 'agree' | 'reject';

export type SignEvidenceAnswerSnapshot = {
  itemId: string;
  category: string;
  label: string;
  value: string | string[] | null;
};

export type SignEvidenceDocument = {
  id: string;
  templateCode: string;
  version: string;
  consent: SignConsentValue | null;
  reviewedAt: string;
  originalFilePath: string;
  originalHash?: string | null;
  signedObjectKey?: string | null;
  signedHash?: string | null;
  answers?: Record<string, string | string[]>;
  answerSnapshot?: SignEvidenceAnswerSnapshot[];
};

export type SignEvidencePayload = {
  schemaVersion: '1.0';
  requestNo: string;
  claimNo: string;
  tokenHash: string;
  signer: {
    name: string;
    role: string;
    phone?: string;
    birth?: string;
  };
  auth: {
    provider: string;
    transactionId: string;
    identityVerifiedAt: string;
    ci?: string;
  };
  documents: SignEvidenceDocument[];
  signature: {
    typedName: string;
    imageSha256: string;
    pointCount: number;
  };
  client: {
    userAgent: string;
    language: string;
    screen: string;
    ip?: string;
  };
  completedAt: string;
  tsa: null;
  /** NCP 서명 PDF 전체 경로 (예: signed/2026-08-05/REQ-xxx/signed.pdf) */
  signed_file_path?: string | null;
  ip?: string | null;
  user_agent?: string | null;
};

export type CompleteSignRequestBody = {
  token: string;
  evidence: SignEvidencePayload;
  evidenceHash: string;
};

export type CompleteSignResponseBody = {
  ok: true;
  signTransactionId: string;
  finalHash: string;
  completedAt: string;
  evidenceObjectKey: string;
  request: {
    request_no: string;
    status: 'COMPLETED';
    completed_at: string;
  };
  backendSynced: boolean;
};

export type UploadSignedPdfResponseBody = {
  ok: true;
  documentId: string;
  objectKey: string;
  signedHash: string;
  contentType: string;
  sizeBytes: number;
};
