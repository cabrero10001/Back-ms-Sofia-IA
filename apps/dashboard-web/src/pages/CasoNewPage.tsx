import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import type { ApiResponse, Caso } from '../types';

const AREAS = ['CIVIL', 'PENAL', 'LABORAL', 'FAMILIA', 'ADMINISTRATIVO', 'CONSTITUCIONAL', 'COMERCIAL', 'OTRO'];

export function CasoNewPage() {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    setSaving(true);
    setError(null);
    try {
      const res = await apiClient.post<ApiResponse<Caso>>('/casos', {
        descripcion: formData.get('descripcion') || undefined,
        areaDerecho: formData.get('areaDerecho') || undefined,
        telefonoContacto: formData.get('telefonoContacto') || undefined,
      });
      navigate(`/casos/${res.data.id}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-4 text-sm text-gray-400">
        <Link to="/casos" className="hover:text-primary-light">Casos</Link>
        <span className="mx-2">/</span>
        <span className="text-gray-600">Nuevo</span>
      </div>

      <h2 className="text-2xl font-bold text-gray-800 mb-6">Crear Nuevo Caso</h2>

      <div className="max-w-xl bg-white rounded-lg shadow p-6">
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Descripcion del caso
            </label>
            <textarea
              name="descripcion"
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-light"
              placeholder="Describa brevemente la situacion legal..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Area de Derecho
            </label>
            <select
              name="areaDerecho"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-light"
            >
              <option value="">Seleccionar area...</option>
              {AREAS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Telefono de contacto
            </label>
            <input
              name="telefonoContacto"
              type="tel"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-light"
              placeholder="+57 300 123 4567"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-primary text-white rounded-md text-sm font-medium hover:bg-primary-dark transition-colors disabled:opacity-50"
            >
              {saving ? 'Guardando...' : 'Crear Caso'}
            </button>
            <Link
              to="/casos"
              className="px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
