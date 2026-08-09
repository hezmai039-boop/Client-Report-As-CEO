import { readFileSync } from 'node:fs';
import { db } from './db.js';

/**
 * استيراد تاريخي (المهمة 5 من README) — يقرأ CSV مصدَّراً من ورقة
 * "البيانات اليومية" في سجل عميل بالنظام القديم (Google Sheets)
 * ويحقنه في DailyEntry مع الحفاظ على حارس التكرار (unique).
 *
 * الاستخدام:
 *   npm run import:csv -- "<اسم العميل كما في القاعدة>" <مسار الملف.csv>
 *
 * الأعمدة المدعومة (رؤوس عربية كما في Sheets — الترتيب غير مهم):
 *   التاريخ | الإيرادات | عدد العمليات | التكلفة | عملاء جدد |
 *   عملاء متكررون | مصروفات التسويق | رضا العملاء | أبرز صنف |
 *   مؤشر قطاعي | ملاحظات
 * الصفوف المكررة (نفس اليوم) تُتخطى بصمت — القاعدة تحمي نفسها.
 */

const HEADER_MAP: Record<string, string> = {
  'التاريخ': 'dataDate',
  'تاريخ البيانات': 'dataDate',
  'الإيرادات': 'revenue',
  'إجمالي الإيرادات': 'revenue',
  'عدد العمليات': 'operationsCount',
  'التكلفة': 'cost',
  'تكلفة البضاعة/التشغيل': 'cost',
  'عملاء جدد': 'newClients',
  'عملاء متكررون': 'repeatClients',
  'مصروفات التسويق': 'marketingSpend',
  'رضا العملاء': 'satisfaction',
  'رضا العملاء (1-5)': 'satisfaction',
  'أبرز صنف': 'topItem',
  'أبرز صنف/خدمة': 'topItem',
  'مؤشر قطاعي': 'sectorIndicator',
  'مؤشر قطاعي إضافي': 'sectorIndicator',
  'ملاحظات': 'notes',
  'ملاحظات اليوم': 'notes',
};

// مفكك CSV بسيط يدعم القيم المقتبسة "..." والفواصل داخلها
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

function parseDate(v: string): Date | null {
  const t = v.trim();
  // yyyy-mm-dd أو dd-mm-yyyy أو dd/mm/yyyy
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);
  m = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return new Date(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
}

const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(/[^\d.-]/g, '')) || null);
const txt = (v: string) => (v.trim() === '' ? null : v.trim());

async function main() {
  const [clientName, csvPath] = process.argv.slice(2);
  if (!clientName || !csvPath) {
    console.error('الاستخدام: npm run import:csv -- "<اسم العميل>" <مسار الملف.csv>');
    process.exit(1);
  }

  const client = await db.client.findUnique({ where: { name: clientName } });
  if (!client) {
    console.error(`❌ لا يوجد عميل باسم "${clientName}" — الأسماء المتاحة:`);
    for (const c of await db.client.findMany({ select: { name: true } })) console.error(`   • ${c.name}`);
    process.exit(1);
  }

  const rows = parseCsv(readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, ''));
  if (rows.length < 2) {
    console.error('❌ الملف فارغ أو بلا صفوف بيانات');
    process.exit(1);
  }

  const headers = rows[0].map((h) => HEADER_MAP[h.trim()] ?? null);
  if (!headers.includes('dataDate')) {
    console.error(`❌ لا يوجد عمود تاريخ معروف. الرؤوس الموجودة: ${rows[0].join(' | ')}`);
    process.exit(1);
  }

  let imported = 0, skipped = 0, invalid = 0;
  for (const cells of rows.slice(1)) {
    const rec: Record<string, string> = {};
    headers.forEach((key, i) => { if (key && cells[i] !== undefined) rec[key] = cells[i]; });

    const dataDate = parseDate(rec.dataDate ?? '');
    if (!dataDate) { invalid++; continue; }

    try {
      await db.dailyEntry.create({
        data: {
          clientId: client.id,
          dataDate,
          revenue: num(rec.revenue ?? ''),
          operationsCount: num(rec.operationsCount ?? ''),
          cost: num(rec.cost ?? ''),
          newClients: num(rec.newClients ?? ''),
          repeatClients: num(rec.repeatClients ?? ''),
          marketingSpend: num(rec.marketingSpend ?? ''),
          satisfaction: num(rec.satisfaction ?? ''),
          topItem: txt(rec.topItem ?? ''),
          sectorIndicator: txt(rec.sectorIndicator ?? ''),
          notes: txt(rec.notes ?? ''),
        },
      });
      imported++;
    } catch (err) {
      // P2002 = نفس اليوم موجود مسبقاً — الحارس يعمل، نتخطى
      if ((err as { code?: string }).code === 'P2002') skipped++;
      else throw err;
    }
  }

  console.log(`✅ ${client.name}: استُورد ${imported} صفاً — تُخطي ${skipped} مكرراً — ${invalid} بتاريخ غير صالح`);
}

main().then(() => db.$disconnect());
