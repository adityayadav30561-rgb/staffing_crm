import type { FastifyInstance } from 'fastify';
import { authRoutes } from './auth';
import { userRoutes } from './users';
import { adminRoutes } from './admin';
import { clientRoutes } from './clients';
import { requirementRoutes } from './requirements';
import { candidateRoutes } from './candidates';
import { applicationRoutes } from './applications';
import { taskRoutes } from './tasks';
import { placementRoutes } from './placements';
import { reportRoutes } from './reports';
import { importRoutes } from './import';
import { publicRoutes } from './public';

export async function registerRoutes(app: FastifyInstance) {
  for (const r of [
    authRoutes,
    userRoutes,
    adminRoutes,
    clientRoutes,
    requirementRoutes,
    candidateRoutes,
    applicationRoutes,
    taskRoutes,
    placementRoutes,
    reportRoutes,
    importRoutes,
    publicRoutes,
  ]) {
    await app.register(r);
  }
}
