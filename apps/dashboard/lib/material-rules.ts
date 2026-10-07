export type FileVersion = 'legacy' | 'current';
export type SourceState = 'in_progress' | 'archived';
export type ReceiptStatus = 'completed' | 'pending' | 'shortage' | 'quantity_difference' | 'receipt_issue' | 'extra_pn' | 'review_required';
export type DataQualityStatus = 'complete' | 'missing_metadata' | 'legacy_incomplete';

export interface MaterialInput {
  workOrder: string; fileVersion: FileVersion; sourceState: SourceState;
  operator?: string | null; confirmationTime?: string | null;
  requiredPn: number; receivedPn: number; pnDifference: number;
  receiptQty: number; issueQty: number; qtyDifference: number;
  shortageCount: number; extraPnCount: number;
  actualReceiptQtyDiffCount?: number | null; lastUpdated: string;
  sourceDocumentUrl?: string;
  sourceFile?: string;
  sourceObjectKey?: string;
}

export interface MaterialRecord extends MaterialInput {
  completionRate: number; receiptStatus: ReceiptStatus;
  dataQualityStatus: DataQualityStatus; actionRequired: boolean;
  reasonZh: string; reasonEn: string;
}

export function evaluateMaterial(input: MaterialInput): MaterialRecord {
  const completionRate = input.requiredPn <= 0 ? 0 : Math.min(100, Math.round((input.receivedPn / input.requiredPn) * 100));
  let receiptStatus: ReceiptStatus;
  let reasonZh: string;
  let reasonEn: string;

  if (input.shortageCount > 0) {
    receiptStatus = 'shortage'; reasonZh = `發現 ${input.shortageCount} 筆缺料，必須確認並處理。`; reasonEn = `${input.shortageCount} shortage item(s) found. Confirmation and action are required.`;
  } else if (input.fileVersion === 'legacy' && input.extraPnCount > 0) {
    receiptStatus = 'review_required'; reasonZh = '舊版多給 PN 可能是資料結構造成的誤判，必須人工複核。'; reasonEn = 'Legacy Extra PN may be a data-structure false positive. Manual review is required.';
  } else if (input.fileVersion === 'current' && input.extraPnCount > 0) {
    receiptStatus = 'extra_pn'; reasonZh = `發現 ${input.extraPnCount} 筆多給 PN，必須確認來源。`; reasonEn = `${input.extraPnCount} Extra PN item(s) found. The source must be checked.`;
  } else if (input.receivedPn < input.requiredPn) {
    receiptStatus = 'pending'; reasonZh = '尚有 PN 未完成點收。'; reasonEn = 'Some required PN items have not been received.';
  } else if (input.qtyDifference !== 0) {
    receiptStatus = 'quantity_difference'; reasonZh = '點收數量與出庫數量不一致，必須確認。'; reasonEn = 'Receipt quantity does not match issue quantity. Confirmation is required.';
  } else if (input.pnDifference !== 0 || (input.actualReceiptQtyDiffCount ?? 0) > 0) {
    receiptStatus = 'receipt_issue'; reasonZh = '點收資料存在 PN 或實際數量差異。'; reasonEn = 'A PN or actual receipt quantity difference was found.';
  } else {
    receiptStatus = 'completed'; reasonZh = '點收完成，未發現需處理的差異。'; reasonEn = 'Receiving is complete with no actionable difference.';
  }

  const metadataMissing = !input.operator || !input.confirmationTime;
  const isArchivedLegacy = input.fileVersion === 'legacy' && input.sourceState === 'archived';
  const dataQualityStatus: DataQualityStatus = metadataMissing ? (isArchivedLegacy ? 'legacy_incomplete' : 'missing_metadata') : 'complete';
  const actionRequired = receiptStatus !== 'completed' || (metadataMissing && !isArchivedLegacy);
  return { ...input, completionRate, receiptStatus, dataQualityStatus, actionRequired, reasonZh, reasonEn };
}
