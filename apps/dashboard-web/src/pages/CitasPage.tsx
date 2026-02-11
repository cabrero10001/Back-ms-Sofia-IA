import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import type { PaginatedResponse, Cita } from '../types';

const ESTADOS = ['', 'PROGRAMADA', 'CONFIRMADA', 'EN_CURSO', 'COMPLETADA', 'CANCELADA', 'NO_ASISTIO'];

export function CitasPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [citas, setCitas] = useState<Cita[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const page = Number(searchParams.get('page') || '1');
  const estado = searchParams.get('estado') || '';
  const limit = 10;

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ page: String(page), limit: String(limit) });
        if (estado) params.set('estado', estado);

        const res = await apiClient.get<PaginatedResponse<Cita>>(`/citas?${params}`);
        setCitas(res.data);
        setTotal(res.meta.total);
      } catch (err) {
        console.error('Error loading citas:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [page, estado]);

  const totalPages = Math.ceil(total / limit);

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value) params.set(key, value);
    else params.delete(key);
    params.set('page', '1');
    setSearchParams(params);
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 mb-6">Citas</h2>

      {/* Filters */}
      <div className="flex gap-4 mb-4">
        <select
          value={estado}
          onChange={(e) => updateFilter('estado', e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-light"
        >
          <option value="">Todos los estados</option>
          {ESTADOS.filter(Boolean).map((e) => (
            <option key={e} value={e}>{e.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <p className="text-gray-400">Cargando...</p>
      ) : citas.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-400">
          No se encontraron citas
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Fecha y Hora</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Estado</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Caso</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Notas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {citas.map((cita) => (
                <tr key={cita.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-700">
                    {new Date(cita.fechaHora).toLocaleString('es-CO', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={cita.estado} type="cita" /></td>
                  <td className="px-4 py-3 text-gray-500">
                    {cita.caso?.descripcion?.substring(0, 40) || cita.casoId.substring(0, 8) + '...'}
                  </td>
                  <td className="px-4 py-3 text-gray-400 truncate max-w-xs">{cita.notas || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <span className="text-sm text-gray-500">
                {total} cita{total !== 1 ? 's' : ''} encontrada{total !== 1 ? 's' : ''}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => updateFilter('page', String(page - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1 text-sm border rounded disabled:opacity-40"
                >
                  Anterior
                </button>
                <span className="px-3 py-1 text-sm text-gray-500">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => updateFilter('page', String(page + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1 text-sm border rounded disabled:opacity-40"
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
