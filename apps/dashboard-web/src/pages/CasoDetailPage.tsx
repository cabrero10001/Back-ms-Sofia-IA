import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import type { ApiResponse, Caso } from '../types';

const ESTADOS = ['ABIERTO', 'EN_PROGRESO', 'CERRADO', 'DERIVADO'];

export function CasoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [caso, setCaso] = useState<Caso | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await apiClient.get<ApiResponse<Caso>>(`/casos/${id}`);
        setCaso(res.data);
      } catch (err) {
        console.error('Error loading caso:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  const handleEstadoChange = async (nuevoEstado: string) => {
    if (!caso || updating) return;
    setUpdating(true);
    try {
      await apiClient.patch<ApiResponse<Caso>>(`/casos/${caso.id}/estado`, { estado: nuevoEstado });
      setCaso({ ...caso, estado: nuevoEstado as Caso['estado'] });
    } catch (err) {
      console.error('Error updating estado:', err);
    } finally {
      setUpdating(false);
    }
  };

  const handleDelete = async () => {
    if (!caso || !window.confirm('Eliminar este caso?')) return;
    try {
      await apiClient.delete(`/casos/${caso.id}`);
      navigate('/casos', { replace: true });
    } catch (err) {
      console.error('Error deleting caso:', err);
    }
  };

  if (loading) return <p className="text-gray-400">Cargando caso...</p>;
  if (!caso) return <p className="text-red-500">Caso no encontrado</p>;

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-4 text-sm text-gray-400">
        <Link to="/casos" className="hover:text-primary-light">Casos</Link>
        <span className="mx-2">/</span>
        <span className="text-gray-600">Detalle</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">
            {caso.descripcion || 'Caso sin descripcion'}
          </h2>
          <div className="flex items-center gap-3">
            <StatusBadge status={caso.estado} />
            {caso.areaDerecho && (
              <span className="text-sm text-gray-500">
                Area: {caso.areaDerecho}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={handleDelete}
          className="px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded hover:bg-red-50 transition-colors"
        >
          Eliminar
        </button>
      </div>

      {/* Info card */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="lg:col-span-2 bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Informacion del Caso</h3>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-gray-500">ID</dt>
              <dd className="font-mono text-xs text-gray-700 mt-1">{caso.id}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Telefono Contacto</dt>
              <dd className="text-gray-700 mt-1">{caso.telefonoContacto || '-'}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Creado por</dt>
              <dd className="text-gray-700 mt-1">{caso.creadoPor?.nombreCompleto || '-'}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Fecha de creacion</dt>
              <dd className="text-gray-700 mt-1">
                {new Date(caso.creadoEn).toLocaleString('es-CO')}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Es competencia</dt>
              <dd className="text-gray-700 mt-1">
                {caso.esCompetencia === null ? 'No evaluado' : caso.esCompetencia ? 'Si' : 'No'}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Razon</dt>
              <dd className="text-gray-700 mt-1">{caso.razonCompetencia || '-'}</dd>
            </div>
          </dl>
        </div>

        {/* Estado change */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Cambiar Estado</h3>
          <div className="space-y-2">
            {ESTADOS.map((est) => (
              <button
                key={est}
                onClick={() => handleEstadoChange(est)}
                disabled={est === caso.estado || updating}
                className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                  est === caso.estado
                    ? 'bg-primary text-white font-medium'
                    : 'bg-gray-50 text-gray-600 hover:bg-gray-100 disabled:opacity-40'
                }`}
              >
                {est.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Citas table */}
      {caso.citas && caso.citas.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">
            Citas ({caso.citas.length})
          </h3>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-gray-600">Fecha y Hora</th>
                <th className="text-left px-4 py-2 font-medium text-gray-600">Estado</th>
                <th className="text-left px-4 py-2 font-medium text-gray-600">Notas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {caso.citas.map((cita) => (
                <tr key={cita.id}>
                  <td className="px-4 py-2">
                    {new Date(cita.fechaHora).toLocaleString('es-CO', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </td>
                  <td className="px-4 py-2"><StatusBadge status={cita.estado} type="cita" /></td>
                  <td className="px-4 py-2 text-gray-500">{cita.notas || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
