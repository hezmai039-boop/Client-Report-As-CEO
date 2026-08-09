import { PrismaClient } from '@prisma/client';

// عميل Prisma واحد مشترك لكل التطبيق — يستبدل SpreadsheetApp.openById
export const db = new PrismaClient();
