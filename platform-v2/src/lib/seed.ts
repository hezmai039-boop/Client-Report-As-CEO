import { db } from './db.js';

/**
 * بيانات البدء — تنقل عملاءك الأربعة الحاليين من Master Sheet كما هم
 * (npm run seed). البيانات مطابقة حرفياً لورقة "العملاء" بتاريخ
 * 09 أغسطس 2026.
 */
async function main() {
  const clients = [
    {
      name: 'مطعم حاشي باشا فرع لبن - أبو بكر',
      email: 'jkjkzx2030@gmail.com',
      sector: 'مطاعم',
      active: true,
    },
    {
      name: 'وجهة مستثمر',
      email: 'wejhainvest@gmail.com',
      sector: 'خدمات',
      active: true,
      profile: {
        'نوع الكيان': 'شركة',
        'طبيعة النشاط': 'تأسيس شركات أجنبية — استشارات خدمية B2B',
        'المؤشر الأهم للعميل': 'الوصول لعملاء جادين — عدد التواصلات الجادة اليومية',
        'تعليمات خاصة': 'التركيز في التوصيات على التوسع والنمو، وليس خفض التكاليف',
      },
    },
    {
      name: 'وجهة مستثمر - قسم المطاعم',
      email: 'mmokhtar293@gmail.com',
      sector: 'مطاعم وأغذية',
      active: false,
      profile: {
        'نوع الكيان': 'شركة',
        'النشاط': 'تقديم الأكلات الشعبية',
        'المدير العام / جهة الاتصال': 'محمد عيسى',
        'رقم واتساب مُعبّئ البيانات': '0550665606',
        'الهدف المالي الشهري': 'مليون ريال (تقريباً الوضع الحالي)',
        'تفضيلات التوصيات': 'التركيز على رفع المبيعات',
      },
    },
    {
      name: 'وجهة مستثمر - إنجاز المعاملات (نواف طه)',
      email: 'noaf712474666@gmail.com',
      sector: 'خدمات',
      active: false,
      profile: {
        'نوع الكيان': 'مؤسسة',
        'النشاط': 'خدمات عامة',
        'المسؤول': 'نواف طه — مشرف فني إنجاز معاملات خدمية',
        'رقم واتساب مُعبّئ البيانات': '0521671427',
        'المؤشر الأهم للعميل': 'عدد المهام المُنجزة يومياً',
        'تفضيلات التوصيات': 'عدم التوسع حالياً',
      },
      customQuestions: [
        { title: 'عدد المعاملات المُنجزة اليوم', type: 'NUMBER' as const, required: true },
        { title: 'أهم إنجاز اليوم', type: 'PARAGRAPH' as const },
      ],
    },
  ];

  for (const c of clients) {
    const created = await db.client.upsert({
      where: { name: c.name },
      update: {},
      create: {
        name: c.name,
        displayName: c.name,
        email: c.email,
        sector: c.sector,
        active: c.active,
        profileFields: c.profile
          ? { create: Object.entries(c.profile).map(([key, value]) => ({ key, value })) }
          : undefined,
        customQuestions: (c as { customQuestions?: Array<{ title: string; type: 'NUMBER' | 'PARAGRAPH'; required?: boolean }> }).customQuestions
          ? { create: (c as { customQuestions: Array<{ title: string; type: 'NUMBER' | 'PARAGRAPH'; required?: boolean }> }).customQuestions.map((q, i) => ({ ...q, order: i })) }
          : undefined,
      },
    });
    console.log(`✅ ${created.name} — رابط نموذجه: /f/${created.formToken}`);
  }
}

main().then(() => db.$disconnect());
