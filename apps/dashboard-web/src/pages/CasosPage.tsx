import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import type { PaginatedResponse, Caso } from '../types';

const ESTADOS = ['', 'ABIERTO', 'EN_PROGRESO', 'CERRADO', 'DERIVADO'];
const AREAS = ['', 'CIVIL', 'PENAL', 'LABORAL', 'FAMILIA', 'ADMINISTRATIVO', 'CONSTITUCIONAL', 'COMERCIAL', 'OTRO'];

export function CasosPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [casos, setCasos] = useState<Caso[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const page = Number(searchParams.get('page') || '1');
  const estado = searchParams.get('estado') || '';
  const areaDerecho = searchParams.get('areaDerecho') || '';
  const limit = 10;

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ page: String(page), limit: String(limit) });
        if (estado) params.set('estado', estado);
        if (areaDerecho) params.set('areaDerecho', areaDerecho);

        const res = await apiClient.get<PaginatedResponse<Caso>>(`/casos?${params}`);
        setCasos(res.data);
        setTotal(res.meta.total);
      } catch (err) {
        console.error('Error loading casos:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [page, estado, areaDerecho]);

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
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Casos</h2>
        <Link
          to="/casos/nuevo"
          className="px-4 py-2 bg-primary text-white rounded-md text-sm font-medium hover:bg-primary-dark transition-colors"
        >
          + Nuevo Caso
        </Link>
      </div>

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
        <select
          value={areaDerecho}
          onChange={(e) => updateFilter('areaDerecho', e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-light"
        >
          <option value="">Todas las areas</option>
          {AREAS.filter(Boolean).map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <p className="text-gray-400">Cargando...</p>
      ) : casos.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-400">
          No se encontraron casos
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Descripcion</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Area</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Estado</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Creado por</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Fecha</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">Citas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {casos.map((caso) => (
                <tr key={caso.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link to={`/casos/${caso.id}`} className="text-primary-light hover:underline font-medium">
                      {caso.descripcion?.substring(0, 60) || 'Sin descripcion'}
                      {(caso.descripcion?.length ?? 0) > 60 ? '...' : ''}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{caso.areaDerecho || '-'}</td>
                  <td className="px-4 py-3"><StatusBadge status={caso.estado} /></td>
                  <td className="px-4 py-3 text-gray-500">{caso.creadoPor?.nombreCompleto || '-'}</td>
                  <td className="px-4 py-3 text-gray-400">
                    {new Date(caso.creadoEn).toLocaleDateString('es-CO')}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-500">{caso._count?.citas ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <span className="text-sm text-gray-500">
                {total} caso{total !== 1 ? 's' : ''} encontrado{total !== 1 ? 's' : ''}
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
