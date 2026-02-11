const estadoCasoColors: Record<string, string> = {
  ABIERTO: 'bg-blue-100 text-blue-800',
  EN_PROGRESO: 'bg-yellow-100 text-yellow-800',
  CERRADO: 'bg-gray-100 text-gray-800',
  DERIVADO: 'bg-purple-100 text-purple-800',
};

const estadoCitaColors: Record<string, string> = {
  PROGRAMADA: 'bg-blue-100 text-blue-800',
  CONFIRMADA: 'bg-green-100 text-green-800',
  EN_CURSO: 'bg-yellow-100 text-yellow-800',
  COMPLETADA: 'bg-gray-100 text-gray-800',
  CANCELADA: 'bg-red-100 text-red-800',
  NO_ASISTIO: 'bg-orange-100 text-orange-800',
};

interface StatusBadgeProps {
  status: string;
  type?: 'caso' | 'cita';
}

export function StatusBadge({ status, type = 'caso' }: StatusBadgeProps) {
  const colors = type === 'cita' ? estadoCitaColors : estadoCasoColors;
  const colorClass = colors[status] || 'bg-gray-100 text-gray-800';

  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}
