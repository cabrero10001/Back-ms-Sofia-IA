import { ConversationContext, Prisma } from '../generated/prisma';
import { prisma } from '../db/prisma';

const MAX_RETRIES = 3;

export const contextRepository = {
  findLatest(tenantId: string, conversationId: string): Promise<ConversationContext | null> {
    return prisma.conversationContext.findFirst({
      where: {
        tenantId,
        conversationId,
      },
      orderBy: {
        version: 'desc',
      },
    });
  },

  async createNextVersion(
    tenantId: string,
    conversationId: string,
    data: Prisma.InputJsonValue,
  ): Promise<ConversationContext> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        return await prisma.$transaction(async (tx) => {
          const latest = await tx.conversationContext.findFirst({
            where: {
              tenantId,
              conversationId,
            },
            orderBy: {
              version: 'desc',
            },
          });

          const version = (latest?.version ?? 0) + 1;

          return tx.conversationContext.create({
            data: {
              tenantId,
              conversationId,
              version,
              data,
            },
          });
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          attempt < MAX_RETRIES
        ) {
          continue;
        }

        throw error;
      }
    }

    throw new Error('No fue posible persistir contexto');
  },
};
