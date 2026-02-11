import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/auth';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { CasosPage } from './pages/CasosPage';
import { CasoDetailPage } from './pages/CasoDetailPage';
import { CasoNewPage } from './pages/CasoNewPage';
import { CitasPage } from './pages/CitasPage';

export function App() {
  const { checkAuth, token } = useAuthStore();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    checkAuth().finally(() => setReady(true));
  }, [checkAuth]);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400">
        Cargando...
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={token ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="casos" element={<CasosPage />} />
          <Route path="casos/nuevo" element={<CasoNewPage />} />
          <Route path="casos/:id" element={<CasoDetailPage />} />
          <Route path="citas" element={<CitasPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
