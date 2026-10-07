import React from 'react';
import { createRoot } from 'react-dom/client';
import Dashboard from '../app/page.tsx';
import '../app/globals.css';

const root = document.getElementById('root');
if (!root) throw new Error('Dashboard root element was not found.');

createRoot(root).render(
  <React.StrictMode>
    <Dashboard />
  </React.StrictMode>,
);
