import { Channel, Contact } from '../generated/prisma';
import { prisma } from '../db/prisma';

export const contactRepository = {
  upsert(data: {
    tenantId: string;
    channel: Channel;
    externalId: string;
    displayName?: string;
    phone?: string;
  }): Promise<Contact> {
    return prisma.contact.upsert({
      where: {
        tenantId_channel_externalId: {
          tenantId: data.tenantId,
          channel: data.channel,
          externalId: data.externalId,
        },
      },
      update: {
        displayName: data.displayName,
        phone: data.phone,
      },
      create: {
        tenantId: data.tenantId,
        channel: data.channel,
        externalId: data.externalId,
        displayName: data.displayName,
        phone: data.phone,
      },
    });
  },

  findById(tenantId: string, contactId: string): Promise<Contact | null> {
    return prisma.contact.findFirst({
      where: { id: contactId, tenantId },
    });
  },
};
