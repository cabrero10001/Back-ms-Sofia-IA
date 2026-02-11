import { consentimientosRepository } from './consentimientos.repository';
import { CreateConsentimientoDto } from '@sofia/shared-kernel';
import { TipoConsentimiento } from '@sofia/prisma';

export const consentimientosService = {
  async registrar(dto: CreateConsentimientoDto, usuarioId?: string) {
    return consentimientosRepository.crear({
      usuarioId,
      telefono: dto.telefono,
      tipo: TipoConsentimiento.TRATAMIENTO_DATOS,
      versionPolitica: dto.versionPolitica,
      ip: dto.ip,
      userAgent: dto.userAgent,
    });
  },
  async porTelefono(telefono: string) { return consentimientosRepository.buscarPorTelefono(telefono); },
  async porUsuario(usuarioId: string) { return consentimientosRepository.buscarPorUsuario(usuarioId); },
};
