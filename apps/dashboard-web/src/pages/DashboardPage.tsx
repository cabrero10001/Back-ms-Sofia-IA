import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/auth';
import { StatusBadge } from '../components/StatusBadge';
import type { ApiResponse, PaginatedResponse, Caso, Cita, ResumenEstadoCaso, DashboardResumen } from '../types';

export function DashboardPage() {
  const { user } = useAuthStore();
  const [resumen, setResumen] = useState<ResumenEstadoCaso[]>([]);
  const [casoRecientes, setCasoRecientes] = useState<Caso[]>([]);
  const [citasProximas, setCitasProximas] = useState<Cita[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [resumenRes, casosRes, citasRes] = await Promise.all([
          apiClient.get<ApiResponse<DashboardResumen>>('/dashboard/resumen'),
          apiClient.get<PaginatedResponse<Caso>>('/casos?limit=5'),
          apiClient.get<PaginatedResponse<Cita>>('/citas?limit=5'),
        ]);
        setResumen(resumenRes.data.casosPorEstado ?? []);
        setCasoRecientes(casosRes.data);
        setCitasProximas(citasRes.data);
      } catch (err) {
        console.error('Error loading dashboard:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) {
    return <div className="text-gray-500">Cargando resumen...</div>;
  }

  const totalCasos = resumen.reduce((sum, r) => sum + r._count.id, 0);

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 mb-6">
        Bienvenido, {user?.nombreCompleto}
      </h2>

      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Casos" value={totalCasos} color="bg-blue-500" />
        {resumen.map((r) => (
          <StatCard
            key={r.estado}
            label={r.estado.replace(/_/g, ' ')}
            value={r._count.id}
            color={
              r.estado === 'ABIERTO'
                ? 'bg-green-500'
                : r.estado === 'EN_PROGRESO'
                  ? 'bg-yellow-500'
                  : r.estado === 'CERRADO'
                    ? 'bg-gray-500'
                    : 'bg-purple-500'
            }
          />
        ))}
      </div>

      {/* Two column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent cases */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-800">Casos Recientes</h3>
            <Link to="/casos" className="text-sm text-primary-light hover:underline">
              Ver todos
            </Link>
          </div>
          {casoRecientes.length === 0 ? (
            <p className="text-gray-400 text-sm">No hay casos registrados</p>
          ) : (
            <div className="space-y-3">
              {casoRecientes.map((caso) => (
                <Link
                  key={caso.id}
                  to={`/casos/${caso.id}`}
                  className="block p-3 rounded border border-gray-100 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700 truncate flex-1">
                      {caso.descripcion || 'Sin descripcion'}
                    </span>
                    <StatusBadge status={caso.estado} />
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                    {caso.areaDerecho && <span>{caso.areaDerecho}</span>}
                    <span>{new Date(caso.creadoEn).toLocaleDateString('es-CO')}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Upcoming appointments */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-800">Proximas Citas</h3>
            <Link to="/citas" className="text-sm text-primary-light hover:underline">
              Ver todas
            </Link>
          </div>
          {citasProximas.length === 0 ? (
            <p className="text-gray-400 text-sm">No hay citas programadas</p>
          ) : (
            <div className="space-y-3">
              {citasProximas.map((cita) => (
                <div
                  key={cita.id}
                  className="p-3 rounded border border-gray-100"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">
                      {new Date(cita.fechaHora).toLocaleString('es-CO', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </span>
                    <StatusBadge status={cita.estado} type="cita" />
                  </div>
                  {cita.notas && (
                    <p className="text-xs text-gray-400 mt-1 truncate">{cita.notas}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-white rounded-lg shadow p-5">
      <div className="flex items-center gap-3">
        <div className={`w-3 h-3 rounded-full ${color}`} />
        <span className="text-sm text-gray-500">{label}</span>
      </div>
      <p className="text-3xl font-bold text-gray-800 mt-2">{value}</p>
    </div>
  );
}
