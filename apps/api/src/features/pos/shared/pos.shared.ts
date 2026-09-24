import type { FastifyRequest } from 'fastify';
import { storeOf } from '../../../core/auth';
import { prisma } from '../../../core/db';
import { notFound } from '../../../core/errors';

/** Declarations shared by more than one pos feature. */

export async function loadShift(req: FastifyRequest, id: string) {
  const shift = await prisma.shift.findFirst({ where: { id, storeId: storeOf(req) } });
  if (!shift) throw notFound('Shift');
  return shift;
}
