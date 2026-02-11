import { estudiantesRepository } from './estudiantes.repository';
import { CreateEstudianteDto, UpdateEstudianteDto, NotFoundError } from '@sofia/shared-kernel';

export const estudiantesService = {
  async crear(dto: CreateEstudianteDto) {
    return estudiantesRepository.create({
      usuarioId: dto.usuarioId,
      codigo: dto.codigo,
      programa: dto.programa,
      semestre: dto.semestre,
      activoConsultorio: dto.activoConsultorio,
    });
  },

  async listar(page: number, limit: number) {
    const [data, total] = await estudiantesRepository.findMany(page, limit);
    return { data, total };
  },

  async obtener(id: string) {
    const est = await estudiantesRepository.findById(id);
    if (!est) throw new NotFoundError('Estudiante', id);
    return est;
  },

  async actualizar(id: string, dto: UpdateEstudianteDto) {
    const est = await estudiantesRepository.findById(id);
    if (!est) throw new NotFoundError('Estudiante', id);
    return estudiantesRepository.update(id, dto);
  },

  async eliminar(id: string) {
    const est = await estudiantesRepository.findById(id);
    if (!est) throw new NotFoundError('Estudiante', id);
    return estudiantesRepository.delete(id);
  },
};
