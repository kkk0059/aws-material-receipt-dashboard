'use client';

import { useEffect, useMemo, useState } from 'react';
import { demoWorkOrders } from '../lib/demo-data';
import type { MaterialRecord, ReceiptStatus } from '../lib/material-rules';

const statusLabel: Record<ReceiptStatus, string> = {
  completed: '點收完成 / Completed', pending: '尚未完成 / Pending', shortage: '缺料 / Shortage',
  quantity_difference: '數量差異 / Quantity Difference', receipt_issue: '點收異常 / Receipt Issue',
  extra_pn: '多給料號 / Extra PN', review_required: '需要複核 / Review Required',
};
const filters: Array<{ value: 'all' | 'action' | ReceiptStatus; label: string }> = [
  { value: 'all', label: '全部 / All' }, { value: 'action', label: '需要處理 / Action Required' },
  { value: 'completed', label: '已完成 / Completed' }, { value: 'shortage', label: '缺料 / Shortage' },
  { value: 'quantity_difference', label: '數量差異 / Qty Difference' }, { value: 'review_required', label: '需要複核 / Review' },
];
const materialApiBase = (process.env.NEXT_PUBLIC_MATERIAL_API_BASE_URL ?? '').replace(/\/$/, '');
const localSpreadsheetBridge = 'http://127.0.0.1:3102';
// 本機以資料夾監控展示；AWS 版則由 API 產檔並寫入相同的 S3 incoming/ 來源位置。
const demoAutomationAvailable = Boolean(materialApiBase) || process.env.NODE_ENV !== 'production';
const demoStatusOptions = [
  { value: 'completed', label: '正常完成 / Completed' }, { value: 'pending', label: '尚未完成 / Pending' },
  { value: 'shortage', label: '缺料 / Shortage' }, { value: 'quantity_difference', label: '數量差異 / Qty Difference' },
  { value: 'receipt_issue', label: '點收異常 / Receipt Issue' }, { value: 'extra_pn', label: '多給 PN（需複核）/ Extra PN', legacyOnly: true },
  { value: 'damaged_xlsx', label: '損壞 XLSX（失效展示）/ Damaged XLSX', failureDemo: true },
];

function recordsAreEqual(current: MaterialRecord[], next: MaterialRecord[]) {
  return current.length === next.length && current.every((record, index) => {
    const candidate = next[index];
    return candidate?.workOrder === record.workOrder
      && candidate.lastUpdated === record.lastUpdated
      && candidate.receiptStatus === record.receiptStatus
      && candidate.completionRate === record.completionRate
      && candidate.sourceFile === record.sourceFile
      && candidate.dataQualityStatus === record.dataQualityStatus;
  });
}

function mergeDemoRecords(records: MaterialRecord[], current: MaterialRecord[]) {
  const generatedWorkOrders = new Set(records.map((record) => record.workOrder));
  return [...records, ...current.filter((record) => !generatedWorkOrders.has(record.workOrder))];
}

function latestRecordTime(records: MaterialRecord[]) {
  return records.reduce((latest, record) => {
    if (!latest) return record.lastUpdated;
    const recordTime = Date.parse(record.lastUpdated.replace(' ', 'T'));
    const latestTime = Date.parse(latest.replace(' ', 'T'));
    return Number.isNaN(recordTime) || (!Number.isNaN(latestTime) && recordTime <= latestTime) ? latest : record.lastUpdated;
  }, '');
}

/**
 * AWS records are stored as ISO-8601 UTC timestamps.  Do not expose that
 * transport format to dashboard users: render all valid timestamps in the
 * project's Taiwan time zone while retaining the original value for sorting.
 */
function formatDisplayDateTime(value: string): string {
  const normalized = value.includes(' ') ? value.replace(' ', 'T') : value;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(parsed).replace(',', '');
}

export default function Home() {
  const [workOrders, setWorkOrders] = useState<MaterialRecord[]>(demoWorkOrders);
  const [dataSource, setDataSource] = useState<'loading' | 'api' | 'fallback'>('loading');
  const [filter, setFilter] = useState<(typeof filters)[number]['value']>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(demoWorkOrders[0].workOrder);
  const [documentState, setDocumentState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [demoVersion, setDemoVersion] = useState<'current' | 'legacy'>('current');
  const [demoStatus, setDemoStatus] = useState('pending');
  const [demoGenerationState, setDemoGenerationState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [demoDialogOpen, setDemoDialogOpen] = useState(false);
  const [demoNotice, setDemoNotice] = useState('');
  const [monitorMessage, setMonitorMessage] = useState('來源資料夾待命中 / Source folder standby');

  useEffect(() => {
    const controller = new AbortController();
    async function refreshWorkOrders() {
      try {
        const response = await fetch(`${materialApiBase}/work-orders`.replace(/^\/work-orders$/, '/api/work-orders'), { signal: controller.signal });
        if (!response.ok) throw new Error(`API returned ${response.status}`);
        const payload = await response.json() as { data: MaterialRecord[] };
        if (!Array.isArray(payload.data) || payload.data.length === 0) throw new Error('API returned no work orders');
        setWorkOrders((current) => (recordsAreEqual(current, payload.data) ? current : payload.data));
        setDataSource('api');
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setDataSource('fallback');
      }
    }
    void refreshWorkOrders();
    // 本機 Demo 由來源監控服務負責更新，避免本機 API 重複覆蓋動態匯入資料。
    // AWS 則採低成本的 60 秒輪詢。
    if (!materialApiBase) return () => controller.abort();
    const timer = window.setInterval(() => void refreshWorkOrders(), 60_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!demoAutomationAvailable) return;
    // AWS Demo 已由 S3 Event 監控來源位置；不應再嘗試連線本機展示 bridge，
    // 否則雖不影響功能，卻會在雲端畫面顯示不必要的「服務未連線」訊息。
    if (materialApiBase) {
      setMonitorMessage('AWS S3 來源位置監控中 / Monitoring S3 source folder');
      return;
    }
    let cancelled = false;
    async function refreshDemoMonitor() {
      try {
        const response = await fetch(`${localSpreadsheetBridge}/demo/monitor`);
        const payload = response.ok ? await response.json() as { monitor?: { message?: string }; records?: MaterialRecord[] } : null;
        if (cancelled) return;
        if (payload?.monitor?.message) setMonitorMessage(payload.monitor.message);
        if (payload?.records?.length) {
          setWorkOrders((current) => {
            const next = mergeDemoRecords(payload.records!, current);
            return recordsAreEqual(current, next) ? current : next;
          });
        }
      } catch {
        if (!cancelled) setMonitorMessage('Demo 展示服務尚未連線 / Demo service not connected');
      }
    }
    void refreshDemoMonitor();
    const timer = window.setInterval(() => void refreshDemoMonitor(), 3_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  // 成功通知只用於提示本次自動匯入，不應停留在畫面上遮擋操作。
  // 同一個元件供本機與 AWS 看板共用，因此兩種展示模式會一致自動關閉。
  useEffect(() => {
    if (!demoNotice) return;
    const timer = window.setTimeout(() => setDemoNotice(''), 5_000);
    return () => window.clearTimeout(timer);
  }, [demoNotice]);

  async function generateDemoWorkbook() {
    setDemoGenerationState('loading');
    try {
      if (materialApiBase) {
        const scenario = demoStatus === 'damaged_xlsx' ? 'damaged_xlsx' : `${demoVersion}_${demoStatus}`;
        const response = await fetch(`${materialApiBase}/demo/generate`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario }),
        });
        const payload = await response.json() as { data?: { workOrder?: string }; error?: { message?: string } };
        const workOrder = payload.data?.workOrder;
        if (!response.ok || !workOrder) throw new Error(payload.error?.message ?? 'Demo generation failed');
        if (scenario === 'damaged_xlsx') {
          setMonitorMessage(`已寫入損壞 XLSX，預期自動拒收並留下 Log / Damaged XLSX queued for rejection`);
          setDemoNotice(`已送出損壞 XLSX ${workOrder}；請至 CloudWatch Logs 驗證拒收紀錄 / Rejection demo queued`);
          setDemoDialogOpen(false);
          setDemoGenerationState('idle');
          return;
        }
        setMonitorMessage(`已寫入 S3 來源位置，等待自動匯入 ${workOrder} / Uploaded to source, waiting for import`);
        for (let attempt = 0; attempt < 20; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 1000));
          const imported = await fetch(`${materialApiBase}/work-orders/${encodeURIComponent(workOrder)}`);
          if (!imported.ok) continue;
          const importedPayload = await imported.json() as { data?: MaterialRecord };
          if (!importedPayload.data) continue;
          setWorkOrders((current) => [importedPayload.data!, ...current.filter((item) => item.workOrder !== workOrder)]);
          setSelectedId(workOrder);
          setMonitorMessage(`已自動匯入 ${workOrder} / Automatically imported`);
          setDemoNotice(`已自動匯入 ${workOrder} / Automatically imported`);
          setDemoDialogOpen(false);
          setDemoGenerationState('idle');
          return;
        }
        throw new Error('Timed out waiting for automatic import');
      }
      if (demoStatus === 'damaged_xlsx') throw new Error('Damaged XLSX demo is available in AWS Demo mode only.');
      const response = await fetch(`${localSpreadsheetBridge}/demo/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario: `${demoVersion}_${demoStatus}` }),
      });
      const payload = await response.json() as { data?: { record?: MaterialRecord; monitor?: { message?: string } }; error?: string };
      if (!response.ok || !payload.data?.record) throw new Error(payload.error ?? 'Demo generation failed');
      setWorkOrders((current) => [payload.data!.record!, ...current.filter((item) => item.workOrder !== payload.data!.record!.workOrder)]);
      setSelectedId(payload.data.record.workOrder);
      setMonitorMessage(payload.data.monitor?.message ?? `已自動匯入 ${payload.data.record.workOrder}`);
      setDemoNotice(`已自動匯入 ${payload.data.record.workOrder} / Automatically imported`);
      setDemoDialogOpen(false);
      setDataSource('api');
      setDemoGenerationState('idle');
    } catch {
      setMonitorMessage('產生或自動匯入失敗 / Generation or automatic import failed');
      setDemoGenerationState('error');
    }
  }

  async function openSourceDocument(record: MaterialRecord) {
    setDocumentState('loading');
    try {
      // 本機展示不經由瀏覽器傳遞 XLSX，避免 Office/WPS 將 localhost 來源誤判為 HTML。
      // 使用者桌面工作階段啟動的 bridge 僅能開啟此專案內明確列出的 7 份合成 Demo 檔案。
      if (!materialApiBase) {
        const response = await fetch(`${localSpreadsheetBridge}/open/${encodeURIComponent(record.workOrder)}`, { method: 'POST' });
        if (!response.ok) throw new Error(`Local bridge returned ${response.status}`);
        setDocumentState('idle');
        return;
      }

      let url = record.sourceDocumentUrl;
      if (!url) {
        const response = await fetch(`${materialApiBase}/work-orders/${encodeURIComponent(record.workOrder)}/source-document`);
        if (!response.ok) throw new Error(`Source API returned ${response.status}`);
        const payload = await response.json() as { url?: string };
        if (!payload.url) throw new Error('Source API returned no URL');
        url = payload.url;
      }
      // AWS 部署後使用 5 分鐘有效的 HTTPS S3 pre-signed URL，並以唯讀模式開啟來源檔。
      const sourceUrl = new URL(url, window.location.href);
      window.location.assign(`ms-excel:ofv|u|${sourceUrl.href}`);
      setDocumentState('idle');
    } catch {
      setDocumentState('error');
    }
  }

  const filtered = useMemo(() => workOrders.filter((item) => item.workOrder.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || (filter === 'action' ? item.actionRequired : item.receiptStatus === filter))), [filter, query, workOrders]);
  const selected = workOrders.find((item) => item.workOrder === selectedId) ?? filtered[0] ?? workOrders[0];
  const completed = workOrders.filter((item) => item.receiptStatus === 'completed').length;
  const actionCount = workOrders.filter((item) => item.actionRequired).length;
  const overallRate = workOrders.length > 0 ? Math.round(workOrders.reduce((sum, item) => sum + item.completionRate, 0) / workOrders.length) : 0;
  const lastUpdated = latestRecordTime(workOrders);
  const receivedPnGap = selected.receivedPn !== selected.requiredPn;
  const hasQuantityDifference = selected.qtyDifference !== 0;
  const hasShortage = selected.shortageCount > 0;
  const hasExtraPn = selected.extraPnCount > 0;
  const hasActualReceiptDifference = (selected.actualReceiptQtyDiffCount ?? 0) > 0;
  const hasMissingOperator = !selected.operator;
  const hasMissingConfirmationTime = !selected.confirmationTime;

  return <main className="shell">
    <header className="topbar"><div className="brand"><span className="brandMark">M</span><div><strong>物料點收管理看板</strong><span>Material Receiving Dashboard</span></div></div><div className={`systemState ${dataSource === 'fallback' ? 'warning' : ''}`}><i />{dataSource === 'loading' ? '載入資料 / Loading Data' : dataSource === 'api' ? (materialApiBase ? 'AWS API / Synthetic Data Only' : 'Local API / Synthetic Data Only') : '本機備援 / Local Fallback'}</div></header>
    <section className="hero"><div><p className="eyebrow">集中管理 / CENTRAL OPERATIONS</p><h1>工單點收狀態總覽 <span>/ Work Order Receiving Overview</span></h1><p>進度與點收結果分開判斷，異常工單不會被 100% 完成率掩蓋。<br/><span>Progress and receipt status are evaluated separately, so issues are not hidden by a 100% completion rate.</span></p></div><div className="heroTools">{demoAutomationAvailable && <button type="button" className="demoLaunchButton" onClick={() => { setDemoNotice(''); setDemoDialogOpen(true); }}><span>產生 Demo 檔</span><small>Generate Demo File</small></button>}<div className="updated">最後更新 / Last Updated<br/><strong>{lastUpdated ? formatDisplayDateTime(lastUpdated) : '—'}</strong></div></div></section>
    <section className="metrics" aria-label="摘要 Summary"><Metric label="總工單 / Total Work Orders" value={workOrders.length} tone="ink"/><Metric label="點收完成 / Completed" value={completed} tone="green"/><Metric label="需要處理 / Action Required" value={actionCount} tone="red"/><Metric label="平均完成率 / Completion Rate" value={`${overallRate}%`} tone="blue"/></section>
    <section className="workspace">
      <div className="listPanel">
        <div className="panelHead"><div><h2>工單清單</h2><p>Work Order Status</p></div><span>{filtered.length} 筆 / records</span></div>
        <div className="controls"><label className="search"><span>搜尋 / Search</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="輸入 Demo 工單號碼 / Enter Demo Work Order"/></label><div className="filterRow">{filters.map((item) => <button key={item.value} className={filter === item.value ? 'active' : ''} onClick={() => setFilter(item.value)}>{item.label}</button>)}</div></div>
        <div className="tableWrap"><table><thead><tr><th>工單號碼<br/><span>Work Order</span></th><th>PN 覆蓋率<br/><span>PN Coverage</span></th><th>點收結果<br/><span>Receipt Status</span></th><th>資料品質<br/><span>Data Quality</span></th><th>更新時間<br/><span>Last Updated</span></th></tr></thead><tbody>{filtered.map((item) => <tr key={item.workOrder} onClick={() => setSelectedId(item.workOrder)} className={selected.workOrder === item.workOrder ? 'selected' : ''} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setSelectedId(item.workOrder)}><td><strong>{item.workOrder}</strong><small>{item.fileVersion === 'current' ? '新版 / Current' : '舊版 / Legacy'}</small></td><td><div className="progress"><span style={{width:`${item.completionRate}%`}}/></div><b>{item.completionRate}%</b></td><td><span className={`badge ${item.receiptStatus}`}>{statusLabel[item.receiptStatus]}</span></td><td>{item.dataQualityStatus === 'complete' ? <span className="qualityOk">完整 / Complete</span> : <span className="qualityWarn">{item.dataQualityStatus === 'legacy_incomplete' ? '歷史資料不完整 / Legacy Incomplete' : '資料缺失 / Missing Data'}</span>}</td><td>{formatDisplayDateTime(item.lastUpdated)}<small>{item.actionRequired ? '需要處理 / Action Required' : '不需處理 / No Action'}</small></td></tr>)}</tbody></table>{filtered.length === 0 && <div className="empty">找不到符合條件的工單 / No matching work orders</div>}</div>
      </div>
      <aside className="detailPanel">
        <div className="detailTitle"><div><p>工單詳情 / WORK ORDER DETAIL</p><h2>{selected.workOrder}</h2></div><span className={`badge ${selected.receiptStatus}`}>{statusLabel[selected.receiptStatus]}</span></div>
        <div className="detailProgress"><div><span>PN 點收覆蓋率 / PN Receiving Coverage</span><strong>{selected.completionRate}%</strong></div><div className="progress large"><span style={{width:`${selected.completionRate}%`}}/></div><small>{selected.receivedPn} / {selected.requiredPn} PN　僅比較需求 PN 與已有點收紀錄的 PN；不代表缺料、數量或實點差異已排除<br/>Compares required PN with PN having a receipt record only; shortages and quantity exceptions are checked separately</small></div>
        <dl className="facts"><Fact label="需求 PN / Required PN" value={selected.requiredPn}/><Fact label="已點收 PN / Received PN" value={selected.receivedPn} tone={receivedPnGap ? 'exception' : undefined}/><Fact label="數量差異 / Qty Difference" value={selected.qtyDifference.toLocaleString()} tone={hasQuantityDifference ? 'exception' : undefined}/><Fact label="缺料數 / Shortage" value={selected.shortageCount} tone={hasShortage ? 'exception' : undefined}/><Fact label="多給 PN / Extra PN" value={selected.extraPnCount} tone={hasExtraPn ? 'exception' : undefined}/><Fact label="實點差異 / Actual Qty Diff" value={selected.actualReceiptQtyDiffCount ?? '不適用 / N/A'} tone={hasActualReceiptDifference ? 'exception' : undefined}/></dl>
        <div className={`actionBox ${selected.actionRequired ? 'needsAction' : ''}`}><strong>{selected.actionRequired ? '需要處理 / Action Required' : '目前不需處理 / No Action Required'}</strong><p>{selected.reasonZh}</p><p>{selected.reasonEn}</p></div>
        {(selected.sourceDocumentUrl || dataSource === 'api') && <><button className="documentButton" type="button" disabled={documentState === 'loading'} onClick={() => openSourceDocument(selected)}><span>{documentState === 'loading' ? '正在開啟文件 / Opening File' : '開啟來源文件'}</span><small>{documentState === 'loading' ? 'Please wait' : 'Open Source File'}</small></button><p className="documentHint">本機展示會使用 Windows 預設試算表程式開啟（Excel 或 WPS）。 / Opens with your Windows default spreadsheet app.</p></>}
        {documentState === 'error' && <p className="documentError">無法開啟來源文件，請確認本機展示服務正在執行。 / Unable to open the source file. Confirm the local demo service is running.</p>}
        <div className="meta"><span>作業人員 / Operator</span><strong className={hasMissingOperator ? 'exception' : undefined}>{selected.operator ?? '未提供 / Missing'}</strong><span>確認時間 / Confirmation Time</span><strong className={hasMissingConfirmationTime ? 'exception' : undefined}>{selected.confirmationTime ?? '未提供 / Missing'}</strong></div>
      </aside>
    </section>
    {demoDialogOpen && <div className="demoDialogBackdrop" role="presentation" onMouseDown={() => demoGenerationState !== 'loading' && setDemoDialogOpen(false)}><section className="demoDialog" role="dialog" aria-modal="true" aria-label="產生 Demo 檔" onMouseDown={(event) => event.stopPropagation()}><div className="automationHead"><div><strong>Demo 自動化 / Demo Automation</strong><small>{monitorMessage}</small></div><button type="button" className="dialogClose" onClick={() => setDemoDialogOpen(false)} disabled={demoGenerationState === 'loading'} aria-label="關閉">×</button></div><span className={demoGenerationState === 'error' ? 'automationState error' : 'automationState'}><i />{demoGenerationState === 'loading' ? '來源檔偵測與匯入中 / Detecting & Importing' : '來源位置監控中 / Monitoring source folder'}</span><div className="demoOptionGrid"><div className="demoOptionGroup versionChoice"><span>1　選擇版本 / Select Version</span><div><button type="button" className={demoVersion === 'current' ? 'selected' : ''} onClick={() => { setDemoVersion('current'); if (demoStatus === 'extra_pn') setDemoStatus('pending'); }} disabled={demoGenerationState === 'loading'}>新版 / Current</button><button type="button" className={demoVersion === 'legacy' ? 'selected' : ''} onClick={() => setDemoVersion('legacy')} disabled={demoGenerationState === 'loading'}>舊版 / Legacy</button></div></div><div className="demoOptionGroup statusChoice"><span>2　選擇情境 / Select Scenario</span><div>{demoStatusOptions.filter((item) => !item.legacyOnly || demoVersion === 'legacy').map((item) => <button type="button" key={item.value} className={demoStatus === item.value ? 'selected' : ''} onClick={() => setDemoStatus(item.value)} disabled={demoGenerationState === 'loading'}>{item.failureDemo ? '⚠ ' : ''}{item.label}</button>)}</div><small>⚠ 損壞 XLSX 僅供 AWS 失效展示；預期結果為拒收、移至 rejected/ 並記錄 CloudWatch Log</small></div></div><button type="button" className="generateDemoButton" onClick={generateDemoWorkbook} disabled={demoGenerationState === 'loading'}>{demoGenerationState === 'loading' ? '偵測並匯入中 / Detecting & Importing' : demoStatus === 'damaged_xlsx' ? '送出損壞 XLSX / Send Damaged XLSX' : '產生 Demo 檔 / Generate Demo File'}</button></section></div>}
    {demoNotice && <div className="demoToast" role="status">{demoNotice}</div>}
  </main>;
}

function Metric({label,value,tone}:{label:string;value:number|string;tone:string}) { return <article className={`metric ${tone}`}><span>{label}</span><strong>{value}</strong><i/></article>; }
function Fact({label,value,tone}:{label:string;value:number|string;tone?:'exception'}) { return <div className={tone}><dt>{label}</dt><dd>{value}</dd></div>; }
