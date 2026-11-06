import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { PlaceholderPage } from './pages/PlaceholderPage';

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <DashboardPage /> },
      {
        path: 'estimates',
        element: <PlaceholderPage title="Estimates" stage="Stage 5/6 — Estimate Builder & Repository" />,
      },
      {
        path: 'catalogue',
        element: <PlaceholderPage title="Product Catalogue" stage="Stage 4 — Product Catalogue" />,
      },
      {
        path: 'menu-cards',
        element: <PlaceholderPage title="Menu Cards" stage="Stage 3 — Menu Card Management" />,
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
