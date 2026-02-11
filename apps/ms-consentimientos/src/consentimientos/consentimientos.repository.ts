import { prisma, Consentimiento, TipoConsentimiento } from '@sofia/prisma';

export const consentimientosRepository = {
  crear(data: { usuarioId?: string; telefono?: string; tipo: TipoConsentimiento; versionPolitica: string; ip?: string; userAgent?: string }): Promise<Consentimiento> {
    return prisma.consentimiento.create({ data });
  },

  buscarPorTelefono(telefono: string): Promise<Consentimiento[]> {
    return prisma.consentimiento.findMany({ where: { telefono }, orderBy: { aceptadoEn: 'desc' } });
  },

  buscarPorUsuario(usuarioId: string): Promise<Consentimiento[]> {
    return prisma.consentimiento.findMany({ where: { usuarioId }, orderBy: { aceptadoEn: 'desc' } });
  },
};
