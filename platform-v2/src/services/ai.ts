import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env.js';

/**
 * تحليل Gemini — يستبدل استدعاء Gemini من Apps Script بنفس النموذج
 * (gemini-flash-latest) ونفس روح التوصيات، مع احترام "تفضيلات
 * التوصيات" من ملف العميل (مثال حقيقي: نواف طه — "عدم التوسع حالياً").
 */

const genAI = env.gemini.apiKey ? new GoogleGenerativeAI(env.gemini.apiKey) : null;

export interface EntrySummaryInput {
  clientDisplayName: string;
  sector: string | null;
  periodLabel: string;
  metrics: Record<string, string | number | null>;
  recommendationPreferences?: string | null;
}

export async function generateRecommendations(input: EntrySummaryInput): Promise<string> {
  if (!genAI) {
    return 'لم يُضبط GEMINI_API_KEY — أضِفه في .env لتفعيل التوصيات الذكية.';
  }

  const model = genAI.getGenerativeModel({ model: env.gemini.model });

  const metricsText = Object.entries(input.metrics)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');

  const prefs = input.recommendationPreferences
    ? `\n\nقيد إلزامي من ملف العميل — يجب أن تلتزم به التوصيات حرفياً: ${input.recommendationPreferences}`
    : '';

  const prompt =
    `أنت مستشار أعمال في شركة مساري لريادة الأعمال. حلّل مؤشرات أداء ` +
    `العميل "${input.clientDisplayName}" (قطاع: ${input.sector ?? 'غير محدد'}) ` +
    `لفترة ${input.periodLabel}:\n\n${metricsText}${prefs}\n\n` +
    `اكتب بالعربية: (1) قراءة موجزة للأداء في سطرين، (2) ثلاث توصيات ` +
    `عملية محددة قابلة للتنفيذ غداً صباحاً. بلا مقدمات ولا مجاملات.`;

  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}
