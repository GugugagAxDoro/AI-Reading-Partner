import React from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import App from './App';
import LibraryPage from './pages/LibraryPage';
import ReaderPage from './pages/ReaderPage';
import './styles.css';
import 'pdfjs-dist/web/pdf_viewer.css';

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <LibraryPage /> },
      { path: 'read/:projectId/:documentId', element: <ReaderPage /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
