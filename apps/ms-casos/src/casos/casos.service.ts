import { casosRepository } from './casos.repository';
import {
  CreateCasoDto,
  UpdateCasoDto,
  UpdateEstadoCasoDto,
  NotFoundError,
} from '@sofia/shared-kernel';

export const casosService = {
  async crear(dto: CreateCasoDto, creadoPorUsuarioId?: string) {
    return casosRepository.create({
      creadoPorUsuarioId,
      telefonoContacto: dto.telefonoContacto,
      areaDerecho: dto.areaDerecho,
      descripcion: dto.descripcion,
    });
  },

  async listar(filters: {
    estado?: string;
    areaDerecho?: string;
    creadoPorUsuarioId?: string;
    page: number;
    limit: number;
  }) {
    const [data, total] = await casosRepository.findMany(filters);
    return { data, total };
  },

  async obtener(id: string) {
    const caso = await casosRepository.findById(id);
    if (!caso) throw new NotFoundError('Caso', id);
    return caso;
  },

  async actualizar(id: string, dto: UpdateCasoDto) {
    const existing = await casosRepository.findById(id);
    if (!existing) throw new NotFoundError('Caso', id);
    return casosRepository.update(id, {
      telefonoContacto: dto.telefonoContacto,
      areaDerecho: dto.areaDerecho,
      descripcion: dto.descripcion,
      esCompetencia: dto.esCompetencia,
      razonCompetencia: dto.razonCompetencia,
    });
  },

  async actualizarEstado(id: string, dto: UpdateEstadoCasoDto) {
    const existing = await casosRepository.findById(id);
    if (!existing) throw new NotFoundError('Caso', id);
    return casosRepository.updateEstado(id, dto.estado);
  },

  async eliminar(id: string) {
    const existing = await casosRepository.findById(id);
    if (!existing) throw new NotFoundError('Caso', id);
    return casosRepository.delete(id);
  },
};
