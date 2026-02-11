import { Channel, Conversation, ConversationStatus } from '../generated/prisma';
import { prisma } from '../db/prisma';

const ACTIVE_STATUSES: ConversationStatus[] = [
  ConversationStatus.OPEN,
  ConversationStatus.WAITING_INPUT,
  ConversationStatus.HANDOFF,
];

export const conversationRepository = {
  findActiveByContact(tenantId: string, contactId: string, channel: Channel): Promise<Conversation | null> {
    return prisma.conversation.findFirst({
      where: {
        tenantId,
        contactId,
        channel,
        status: { in: ACTIVE_STATUSES },
      },
      orderBy: { updatedAt: 'desc' },
    });
  },

  create(tenantId: string, contactId: string, channel: Channel): Promise<Conversation> {
    return prisma.conversation.create({
      data: {
        tenantId,
        contactId,
        channel,
        status: ConversationStatus.OPEN,
        lastMessageAt: new Date(),
      },
    });
  },

  findById(tenantId: string, id: string): Promise<Conversation | null> {
    return prisma.conversation.findFirst({
      where: { id, tenantId },
    });
  },
};
