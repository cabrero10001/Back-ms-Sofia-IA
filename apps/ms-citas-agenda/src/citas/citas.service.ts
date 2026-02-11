import { citasRepository } from './citas.repository';
import { CreateCitaDto, UpdateEstadoCitaDto, NotFoundError } from '@sofia/shared-kernel';

export const citasService = {
  async crear(dto: CreateCitaDto) {
    return citasRepository.create({
      casoId: dto.casoId,
      fechaHora: new Date(dto.fechaHora),
      notas: dto.notas,
    });
  },

  async listar(filters: { casoId?: string; estado?: string; page: number; limit: number }) {
    const [data, total] = await citasRepository.findMany(filters);
    return { data, total };
  },

  async obtener(id: string) {
    const cita = await citasRepository.findById(id);
    if (!cita) throw new NotFoundError('Cita', id);
    return cita;
  },

  async actualizarEstado(id: string, dto: UpdateEstadoCitaDto) {
    const existing = await citasRepository.findById(id);
    if (!existing) throw new NotFoundError('Cita', id);
    return citasRepository.updateEstado(id, dto.estado, dto.notas);
  },
};
