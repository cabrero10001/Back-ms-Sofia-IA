import { Direction, Message, MessageType, Prisma } from '../generated/prisma';
import { prisma } from '../db/prisma';

export const messageRepository = {
  findByProviderMessageId(tenantId: string, providerMessageId: string): Promise<Message | null> {
    return prisma.message.findFirst({
      where: {
        tenantId,
        providerMessageId,
      },
    });
  },

  createAndTouchConversation(data: {
    tenantId: string;
    conversationId: string;
    contactId: string;
    direction: Direction;
    type: MessageType;
    text?: string;
    payload: Prisma.InputJsonValue;
    providerMessageId?: string;
  }): Promise<Message> {
    const now = new Date();

    return prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          tenantId: data.tenantId,
          conversationId: data.conversationId,
          contactId: data.contactId,
          direction: data.direction,
          type: data.type,
          text: data.text,
          payload: data.payload,
          providerMessageId: data.providerMessageId,
          createdAt: now,
        },
      });

      await tx.conversation.updateMany({
        where: {
          id: data.conversationId,
          tenantId: data.tenantId,
        },
        data: {
          lastMessageAt: now,
        },
      });

      return message;
    });
  },
};
