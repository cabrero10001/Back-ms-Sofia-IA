import { PrismaClient, Rol, EstadoUsuario } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  const adminHash = await bcrypt.hash('Admin123!', 10);
  const estudianteHash = await bcrypt.hash('Estudiante123!', 10);

  const admin = await prisma.usuario.upsert({
    where: { correo: 'admin@sofia.edu.co' },
    update: {},
    create: {
      nombreCompleto: 'Administrador SOFIA',
      correo: 'admin@sofia.edu.co',
      telefono: '+573001234567',
      passwordHash: adminHash,
      rol: Rol.ADMIN_CONSULTORIO,
      estado: EstadoUsuario.ACTIVO,
    },
  });

  const estUser = await prisma.usuario.upsert({
    where: { correo: 'estudiante@sofia.edu.co' },
    update: {},
    create: {
      nombreCompleto: 'Estudiante Demo',
      correo: 'estudiante@sofia.edu.co',
      telefono: '+573009876543',
      passwordHash: estudianteHash,
      rol: Rol.ESTUDIANTE,
      estado: EstadoUsuario.ACTIVO,
    },
  });

  await prisma.estudiante.upsert({
    where: { usuarioId: estUser.id },
    update: {},
    create: {
      usuarioId: estUser.id,
      codigo: 'EST-2024-001',
      programa: 'Derecho',
      semestre: 8,
      activoConsultorio: true,
    },
  });

  console.log('✅ Seed completado:', {
    admin: admin.correo,
    estudiante: estUser.correo,
  });
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
