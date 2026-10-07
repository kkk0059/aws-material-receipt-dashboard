import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '物料點收管理看板 | Material Receiving Dashboard',
  description: '以合成資料展示工單點收進度、異常狀態與資料品質的雙語管理看板。',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant"><body>{children}</body></html>;
}
