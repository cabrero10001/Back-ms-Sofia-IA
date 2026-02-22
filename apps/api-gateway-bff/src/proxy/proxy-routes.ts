import { Router, Request, RequestHandler } from 'express';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';
import { env } from '../config';
import { jwtVerify, jwtOptional, requireRole } from '../middlewares/jwt-verify';
import { Rol } from '@sofia/shared-kernel';

export const proxyRouter = Router();

// ── Helper: crear proxy hacia un MS ─────────────────
function msProxy(target: string, pathRewrite?: Record<string, string>): RequestHandler {
  const opts: Options = {
    target,
    changeOrigin: true,
    pathRewrite,
    on: {
      proxyReq(proxyReq, req) {
        // Propaga X-Request-Id al microservicio
        const rid = (req as Request).requestId;
        if (rid) proxyReq.setHeader('X-Request-Id', rid);

        // Propaga datos del usuario autenticado como headers internos
        const user = (req as Request).user;
        if (user) {
          proxyReq.setHeader('X-User-Id', user.sub);
          proxyReq.setHeader('X-User-Rol', user.rol);
          proxyReq.setHeader('X-User-Correo', user.correo);
        }
      },
    },
  };
  return createProxyMiddleware(opts) as unknown as RequestHandler;
}

// ═══════════════════════════════════════════════════════
//  NOTA IMPORTANTE SOBRE pathRewrite
// ═══════════════════════════════════════════════════════
//
//  Cuando Express procesa  router.use('/api/auth', handler)
//  le entrega al handler un req.url SIN el mount-path.
//  Ejemplo: petición "/api/auth/login" → handler ve "/login".
//
//  Por eso el pathRewrite opera sobre la URL ya stripeada:
//    { '^/': '/auth/' }   →  "/login" se convierte en "/auth/login"
//

// ═══════════════════════════════════════════════════════
//  RUTAS PÚBLICAS (sin JWT)
// ═══════════════════════════════════════════════════════

// Auth: register / login / me → público (me requiere token, pero el MS lo valida internamente)
proxyRouter.use(
  '/api/auth',
  msProxy(env.URL_MS_IDENTIDAD, { '^/': '/auth/' }),
);

// Webhook Telegram -> publico (el proveedor no manda JWT)
proxyRouter.use(
  '/webhook/telegram',
  msProxy(env.URL_MS_TELEGRAM, { '^/': '/telegram/webhook' }),
);

// Webhook WhatsApp -> publico (el proveedor no manda JWT)
proxyRouter.use(
  '/webhook/whatsapp',
  msProxy(env.URL_MS_WHATSAPP, { '^/': '/whatsapp/webhook' }),
);

// ═══════════════════════════════════════════════════════
//  RUTAS PROTEGIDAS (requieren JWT)
// ═══════════════════════════════════════════════════════

// Casos: ADMIN_CONSULTORIO y ESTUDIANTE
proxyRouter.use(
  '/api/casos',
  jwtVerify,
  requireRole(Rol.ADMIN_CONSULTORIO, Rol.ESTUDIANTE),
  msProxy(env.URL_MS_CASOS, { '^/': '/casos/' }),
);

// Citas: cualquier usuario autenticado
proxyRouter.use(
  '/api/citas',
  jwtVerify,
  msProxy(env.URL_MS_CITAS, { '^/': '/citas/' }),
);

// Estudiantes: solo ADMIN_CONSULTORIO
proxyRouter.use(
  '/api/estudiantes',
  jwtVerify,
  requireRole(Rol.ADMIN_CONSULTORIO),
  msProxy(env.URL_MS_ESTUDIANTES, { '^/': '/estudiantes/' }),
);

// Dashboard: ADMIN_CONSULTORIO y ESTUDIANTE
proxyRouter.use(
  '/api/dashboard',
  jwtVerify,
  requireRole(Rol.ADMIN_CONSULTORIO, Rol.ESTUDIANTE),
  msProxy(env.URL_MS_DASHBOARD, { '^/': '/dashboard/' }),
);

// Telegram sesiones/mensajes (acceso desde dashboard, solo admin)
proxyRouter.use(
  '/api/telegram',
  jwtVerify,
  requireRole(Rol.ADMIN_CONSULTORIO),
  msProxy(env.URL_MS_TELEGRAM, { '^/': '/telegram/' }),
);

// WhatsApp sesiones/mensajes (acceso desde dashboard, solo admin)
proxyRouter.use(
  '/api/whatsapp',
  jwtVerify,
  requireRole(Rol.ADMIN_CONSULTORIO),
  msProxy(env.URL_MS_WHATSAPP, { '^/': '/whatsapp/' }),
);

// Consentimientos: JWT opcional (puede venir de webhook o dashboard)
proxyRouter.use(
  '/api/consentimientos',
  jwtOptional,
  msProxy(env.URL_MS_CONSENTIMIENTOS, { '^/': '/consentimientos/' }),
);

// Normativa: cualquier autenticado
proxyRouter.use(
  '/api/normativa',
  jwtVerify,
  msProxy(env.URL_MS_NORMATIVA, { '^/': '/normativa/' }),
);

// Reportes: solo ADMIN
proxyRouter.use(
  '/api/reportes',
  jwtVerify,
  requireRole(Rol.ADMIN_CONSULTORIO),
  msProxy(env.URL_MS_REPORTES, { '^/': '/reportes/' }),
);

// IA: cualquier autenticado (uso desde dashboard)
proxyRouter.use(
  '/api/ia',
  jwtVerify,
  msProxy(env.URL_MS_IA, { '^/': '/ia/' }),
);
