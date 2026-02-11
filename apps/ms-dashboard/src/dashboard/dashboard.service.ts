import { dashboardRepository } from './dashboard.repository';
import { NotFoundError, Rol } from '@sofia/shared-kernel';

export const dashboardService = {
  /**
   * GET /dashboard/citas
   * - ADMIN_CONSULTORIO: ve todas las citas
   * - ESTUDIANTE: ve solo las citas de sus casos
   */
  async citas(rol: string, usuarioId: string, page: number, limit: number) {
    if (rol === Rol.ADMIN_CONSULTORIO) {
      const [data, total] = await dashboardRepository.todasLasCitas(page, limit);
      return { data, total };
    }
    // ESTUDIANTE u otro rol autenticado
    const [data, total] = await dashboardRepository.citasPorEstudiante(usuarioId, page, limit);
    return { data, total };
  },

  async resumen() {
    const casosPorEstado = await dashboardRepository.resumenCasos();
    return { casosPorEstado };
  },

  async caso(id: string) {
    const caso = await dashboardRepository.casoById(id);
    if (!caso) throw new NotFoundError('Caso', id);
    return caso;
  },

  async casos(page: number, limit: number, filters: { estado?: string; areaDerecho?: string }) {
    const [data, total] = await dashboardRepository.listarCasos(page, limit, filters);
    return { data, total };
  },
};
