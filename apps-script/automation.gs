/**
 * منصة تقارير العملاء الآلية — شركة مساري لريادة الأعمال
 * وحدة الأتمتة الكاملة (Zero-Touch)
 *
 * تُضاف هذه الدوال إلى مشروع Apps Script الحالي بجانب ملف "الرمز.gs".
 * لا تحذف أياً من دوالك الحالية — هذا الملف مكمّل وليس بديلاً.
 *
 * المشكلة التي يحلّها:
 *   نموذج Google Form يكتب كل الردود في Master Sheet ← "ردود النموذج 1"،
 *   بينما دالة توليد التقرير تقرأ من السجل الفردي لكل عميل.
 *   لا يوجد اليوم أي كود يصل بين الاثنين — الوصل يتم يدوياً بالنسخ واللصق.
 *   هذا هو مصدر الساعة الضائعة، وهو سبب ظهور "وجهة مستثمر" فارغاً
 *   رغم أنه أرسل بياناته فعلاً بتاريخ 2026/08/06.
 */

/* ============================ الثوابت ============================ */

var MASTER_SHEET_ID = '1Jq9eH0trrzfh-gsk9Utv5abR4KAe8gFDmS1yQSvnF8I';

var TAB_SETTINGS       = 'الإعدادات';
var TAB_CLIENTS        = 'العملاء';
var TAB_FORM_RESPONSES = 'ردود النموذج 1';

var TAB_CLIENT_DAILY   = 'البيانات اليومية';
var TAB_CLIENT_ARCHIVE = 'أرشيف التقارير';
var TAB_CLIENT_PROFILE = 'ملف العميل';

// معرّفات حقول النموذج (مستخرجة من رابط التعبئة المسبقة لعميل "وجهة مستثمر")
var FORM_ENTRY_CLIENT_NAME = 'entry.1667556615';
var FORM_ENTRY_SECTOR      = 'entry.1046534557';

// أعمدة ورقة "العملاء" في Master Sheet (1-based)
var CLIENT_COL_NAME     = 1; // اسم العميل
var CLIENT_COL_SHEET_ID = 2; // معرّف ملف السجل
var CLIENT_COL_EMAIL    = 3; // إيميل العميل
var CLIENT_COL_DISPLAY  = 4; // الاسم الظاهر
var CLIENT_COL_SECTOR   = 5; // القطاع
var CLIENT_COL_ACTIVE   = 6; // مفعّل
var CLIENT_COL_FORM_URL = 7; // رابط النموذج

// أسماء ردود نموذج يجب تجاهلها بصمت (عملاء لن يُسجَّلوا) — بدون هذه
// القائمة، أي رد من اسم غير مسجَّل يُعاد التبليغ عنه يومياً للأبد،
// لأن الرد يبقى في "ردود النموذج 1" ولا شيء يُعلّمه كمُعالَج.
var IGNORED_FORM_NAMES = ['مطعم بيت الطهي'];

/* ========================= دوال مساعدة عامة ========================= */

/** يقرأ قيمة من ورقة الإعدادات بالبحث عن المفتاح في العمود A. */
function getSetting_(key) {
  var rows = SpreadsheetApp.openById(MASTER_SHEET_ID)
      .getSheetByName(TAB_SETTINGS).getDataRange().getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === key) return String(rows[i][1]).trim();
  }
  return '';
}

/** يعيد ورقة داخل ملف العميل، وينشئها بالرؤوس الصحيحة إن كانت مفقودة. */
function getOrCreateTab_(spreadsheet, tabName, headers) {
  var sheet = spreadsheet.getSheetByName(tabName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(tabName);
    if (headers && headers.length) {
      sheet.appendRow(headers);
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

/** يوحّد التاريخ إلى صيغة yyyy/MM/dd لمقارنة آمنة بغض النظر عن نوع الخلية. */
function normalizeDate_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy/MM/dd');
  }
  var text = String(value || '').trim();
  if (!text) return '';
  // يلتقط التاريخ من نص مثل "4:28:50 م 2026/08/06"
  var match = text.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (match) {
    return match[1] + '/' + ('0' + match[2]).slice(-2) + '/' + ('0' + match[3]).slice(-2);
  }
  return text;
}

/** يعيد صفوف ورقة العملاء ككائنات مفهومة. */
function listClients_() {
  var rows = SpreadsheetApp.openById(MASTER_SHEET_ID)
      .getSheetByName(TAB_CLIENTS).getDataRange().getValues();
  var clients = [];
  for (var i = 1; i < rows.length; i++) { // نتخطى صف الرؤوس
    var row = rows[i];
    if (!String(row[CLIENT_COL_NAME - 1]).trim()) continue;
    clients.push({
      rowIndex: i + 1,
      name:    String(row[CLIENT_COL_NAME - 1]).trim(),
      sheetId: String(row[CLIENT_COL_SHEET_ID - 1]).trim(),
      email:   String(row[CLIENT_COL_EMAIL - 1]).trim(),
      display: String(row[CLIENT_COL_DISPLAY - 1]).trim(),
      sector:  String(row[CLIENT_COL_SECTOR - 1]).trim(),
      active:  String(row[CLIENT_COL_ACTIVE - 1]).trim() === 'نعم'
    });
  }
  return clients;
}

/* ============ (1) الحلقة المفقودة: توجيه ردود النموذج ============ */

/**
 * ينقل كل رد نموذج جديد من Master Sheet إلى ورقة "البيانات اليومية"
 * في السجل الفردي للعميل المطابق — وهو ما كان يتم يدوياً حتى الآن.
 *
 * يُربط بمشغّل onFormSubmit ليعمل لحظياً، ويصلح أيضاً أثر رجعي عند
 * تشغيله يدوياً (يمرّ على كل الردود ويتخطى ما سبق نقله).
 *
 * الردود التي لا تطابق أي عميل مسجَّل تُبلَّغ للفريق الداخلي (مرة واحدة
 * لكل اسم غير مكرر)، إلا الأسماء المدرجة في IGNORED_FORM_NAMES — تلك
 * تُتجاهل بصمت لأنها معروفة ومقرَّر عدم تسجيلها.
 */
function routeFormResponses_() {
  var master = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var responses = master.getSheetByName(TAB_FORM_RESPONSES).getDataRange().getValues();
  if (responses.length < 2) return { moved: 0, unknown: [] };

  var clients = listClients_();
  var byName = {};
  clients.forEach(function (c) { byName[c.name] = c; });

  var moved = 0;
  var unknown = [];

  for (var i = 1; i < responses.length; i++) {
    var row = responses[i];
    var clientName = String(row[1]).trim(); // العمود B: اسم العميل
    var dataDate   = normalizeDate_(row[3]); // العمود D: تاريخ البيانات
    if (!clientName || !dataDate) continue;

    if (IGNORED_FORM_NAMES.indexOf(clientName) !== -1) continue;

    var client = byName[clientName];
    if (!client) {
      if (unknown.indexOf(clientName) === -1) unknown.push(clientName);
      continue;
    }
    if (!client.sheetId) continue;

    var clientBook = SpreadsheetApp.openById(client.sheetId);
    var daily = getOrCreateTab_(clientBook, TAB_CLIENT_DAILY, [
      'الطابع الزمني', 'اسم العميل', 'القطاع', 'تاريخ البيانات',
      'إجمالي الإيرادات', 'عدد العمليات', 'تكلفة البضاعة/التشغيل',
      'عملاء جدد', 'عملاء متكررون', 'مصروفات التسويق', 'رضا العملاء',
      'أبرز صنف/خدمة', 'مؤشر قطاعي إضافي', 'ملاحظات اليوم'
    ]);

    // حارس ضد التكرار: لا ننقل نفس اليوم مرتين
    if (dailyRowExists_(daily, dataDate)) continue;

    // نأخذ أول 14 عموداً فقط — العمود 15 في ورقة الردود تكرار لاسم العميل
    daily.appendRow(row.slice(0, 14));
    moved++;

    // العميل بدأ بالفعل بإرسال البيانات — نحدّث حالته
    markClientActive_(client.rowIndex);
  }

  if (unknown.length) {
    MailApp.sendEmail({
      to: getSetting_('OWNER_EMAIL'),
      subject: '[أتمتة مساري] ⚠️ ردود نموذج لعملاء غير مسجَّلين',
      body: 'وصلت بيانات من أسماء غير موجودة في ورقة "العملاء"، ولن تُولَّد لها تقارير:\n\n'
          + unknown.map(function (n) { return '• ' + n; }).join('\n')
          + '\n\nالحل: سجّل العميل عبر onboardNewClient_ ثم أعد تشغيل routeFormResponses_.'
    });
  }

  return { moved: moved, unknown: unknown };
}

/** يفحص إن كان تاريخ بيانات معيّن مسجّلاً مسبقاً في ورقة البيانات اليومية. */
function dailyRowExists_(dailySheet, normalizedDate) {
  var values = dailySheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (normalizeDate_(values[i][3]) === normalizedDate) return true;
  }
  return false;
}

/** يضبط حالة العميل في Master Sheet إلى "نعم" بعد وصول أول بياناته. */
function markClientActive_(rowIndex) {
  SpreadsheetApp.openById(MASTER_SHEET_ID)
      .getSheetByName(TAB_CLIENTS)
      .getRange(rowIndex, CLIENT_COL_ACTIVE)
      .setValue('نعم');
}

/** مشغّل النموذج — يُربط بـ onFormSubmit على Master Sheet. */
function onFormSubmitRoute(e) {
  routeFormResponses_();
}

/* ============ (2) تسجيل عميل جديد بالكامل من نداء واحد ============ */

/**
 * ينشئ عميلاً جديداً كاملاً: سجل فردي بأوراقه الثلاث، صلاحيات،
 * تسجيل في Master Sheet، ورابط نموذج معبّأ مسبقاً باسمه وقطاعه.
 *
 * يستبدل سبع خطوات يدوية عبر خمس أدوات بنداء واحد.
 *
 * @param {string} clientName  اسم العميل كما سيُدخله في النموذج (يجب أن يتطابق حرفياً)
 * @param {string} clientEmail بريد العميل لاستلام التقارير
 * @param {string} sector      القطاع (مطاعم / خدمات / ...)
 * @param {string} displayName الاسم الظاهر في التقرير (اختياري)
 */
function onboardNewClient_(clientName, clientEmail, sector, displayName) {
  clientName = String(clientName).trim();
  if (!clientName) throw new Error('اسم العميل مطلوب.');

  // لا نسمح بتسجيل مكرر يفسد مطابقة الأسماء لاحقاً
  var existing = listClients_().filter(function (c) { return c.name === clientName; });
  if (existing.length) {
    return { status: 'موجود مسبقاً', sheetId: existing[0].sheetId };
  }

  var master = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var folder = DriveApp.getFileById(MASTER_SHEET_ID).getParents().next();

  // 1) إنشاء السجل الفردي بأوراقه الثلاث جاهزة
  var book = SpreadsheetApp.create('سجل - ' + clientName);
  var bookFile = DriveApp.getFileById(book.getId());
  folder.addFile(bookFile);
  DriveApp.getRootFolder().removeFile(bookFile); // ننقله للمجلد بدل تركه في الجذر

  getOrCreateTab_(book, TAB_CLIENT_DAILY, [
    'الطابع الزمني', 'اسم العميل', 'القطاع', 'تاريخ البيانات',
    'إجمالي الإيرادات', 'عدد العمليات', 'تكلفة البضاعة/التشغيل',
    'عملاء جدد', 'عملاء متكررون', 'مصروفات التسويق', 'رضا العملاء',
    'أبرز صنف/خدمة', 'مؤشر قطاعي إضافي', 'ملاحظات اليوم'
  ]);
  getOrCreateTab_(book, TAB_CLIENT_ARCHIVE,
      ['تاريخ الإرسال', 'نوع التقرير', 'الفترة', 'حالة الإرسال']);
  getOrCreateTab_(book, TAB_CLIENT_PROFILE, ['البند', 'القيمة']);

  // حذف الورقة الافتراضية الفارغة التي ينشئها Google تلقائياً
  var defaultSheet = book.getSheetByName('Sheet1') || book.getSheetByName('ورقة1');
  if (defaultSheet && book.getSheets().length > 1) book.deleteSheet(defaultSheet);

  // 2) بناء رابط النموذج المعبّأ مسبقاً — العميل لا يكتب اسمه ولا قطاعه
  var formUrl = getSetting_('FORM_URL')
      + '?usp=pp_url'
      + '&' + FORM_ENTRY_CLIENT_NAME + '=' + encodeURIComponent(clientName)
      + '&' + FORM_ENTRY_SECTOR      + '=' + encodeURIComponent(sector || '');

  // 3) التسجيل في Master Sheet بالترتيب الصحيح للأعمدة
  master.getSheetByName(TAB_CLIENTS).appendRow([
    clientName,
    book.getId(),
    clientEmail,
    displayName || clientName,
    sector || '',
    'لا',            // يتحوّل إلى "نعم" تلقائياً عند وصول أول بيانات
    formUrl
  ]);

  // 4) بريد ترحيبي للعميل يحمل رابطه الجاهز
  if (clientEmail) {
    MailApp.sendEmail({
      to: clientEmail,
      subject: 'رابط إدخال بيانات الأداء — ' + getSetting_('BRAND_NAME'),
      htmlBody: 'مرحباً ' + (displayName || clientName) + '،<br><br>'
              + 'هذا رابطك الخاص لإدخال بيانات الأداء اليومية:<br>'
              + '<a href="' + formUrl + '">' + formUrl + '</a><br><br>'
              + 'بمجرد أول إدخال ستبدأ تقاريرك بالوصول تلقائياً.<br><br>'
              + getSetting_('SENDER_NAME'),
      name: getSetting_('BRAND_NAME')
    });
  }

  // 5) تأكيد داخلي واحد للفريق
  MailApp.sendEmail({
    to: getSetting_('OWNER_EMAIL'),
    subject: '[أتمتة مساري] ✅ تم تسجيل عميل جديد: ' + clientName,
    body: 'السجل: ' + book.getUrl() + '\nالرابط المعبّأ: ' + formUrl
  });

  return { status: 'تم', sheetId: book.getId(), formUrl: formUrl };
}

/* ============ (3) الفحص اليومي: لا عميل يُنسى بعد اليوم ============ */

/**
 * يعمل يومياً: يوجّه أي ردود عالقة، ثم يبلّغ عن كل عميل مسجَّل
 * لم تصل بياناته منذ 3 أيام أو أكثر — بدل اكتشاف ذلك يدوياً بالصدفة.
 */
function dailyHealthCheck_() {
  var routing = routeFormResponses_();
  var stale = [];
  var today = new Date();

  listClients_().forEach(function (client) {
    if (!client.sheetId) {
      stale.push(client.name + ' — لا يوجد معرّف سجل');
      return;
    }
    var values;
    try {
      values = SpreadsheetApp.openById(client.sheetId)
          .getSheetByName(TAB_CLIENT_DAILY).getDataRange().getValues();
    } catch (err) {
      stale.push(client.name + ' — تعذّر فتح السجل: ' + err.message);
      return;
    }

    if (values.length < 2) {
      stale.push(client.name + ' — لم تصل أي بيانات بعد');
      return;
    }

    var latest = normalizeDate_(values[values.length - 1][3]);
    var latestDate = new Date(latest);
    var daysSince = Math.floor((today - latestDate) / (1000 * 60 * 60 * 24));
    if (daysSince >= 3) {
      stale.push(client.name + ' — آخر بيانات قبل ' + daysSince + ' يوماً (' + latest + ')');
    }
  });

  if (stale.length || routing.moved) {
    MailApp.sendEmail({
      to: getSetting_('OWNER_EMAIL'),
      subject: '[أتمتة مساري] تقرير صحة المنصة اليومي',
      body: 'صفوف نُقلت تلقائياً اليوم: ' + routing.moved + '\n\n'
          + (stale.length ? 'عملاء يحتاجون متابعة:\n' + stale.map(function (s) {
              return '• ' + s;
            }).join('\n') : 'كل العملاء يرسلون بياناتهم بانتظام ✅')
    });
  }

  return { moved: routing.moved, stale: stale };
}

/* ============ (4) حارس ضد التقارير المكررة ============ */

/**
 * يفحص أرشيف العميل قبل الإرسال لمنع تكرار نفس التقرير.
 * (أرشيف "مطعم حاشي باشا" يحوي حالياً تقرير 05 أغسطس ثلاث مرات.)
 *
 * الاستخدام داخل sendReportEmail_ أو في بداية generateAndSendReport:
 *   if (alreadySent_(clientSheetId, 'التقرير اليومي', '05 أغسطس 2026')) return;
 */
function alreadySent_(clientSheetId, reportType, periodLabel) {
  var archive = SpreadsheetApp.openById(clientSheetId).getSheetByName(TAB_CLIENT_ARCHIVE);
  if (!archive) return false;
  var values = archive.getDataRange().getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][1]).trim() === String(reportType).trim() &&
        String(values[i][2]).trim() === String(periodLabel).trim() &&
        String(values[i][3]).trim() === 'تم الإرسال') {
      return true;
    }
  }
  return false;
}

/* ============ (5) التنصيب: شغّل هذه مرة واحدة فقط ============ */

/**
 * ينصّب كل المشغّلات المطلوبة ويصلح البيانات العالقة بأثر رجعي.
 * شغّلها مرة واحدة من محرر Apps Script ثم انسَ الموضوع.
 */
function setupAutomation() {
  // إزالة أي مشغّلات سابقة لنفس الدوال حتى لا تتضاعف
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    var fn = trigger.getHandlerFunction();
    if (fn === 'onFormSubmitRoute' || fn === 'dailyHealthCheck_') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // توجيه لحظي عند كل رد نموذج جديد
  ScriptApp.newTrigger('onFormSubmitRoute')
      .forSpreadsheet(MASTER_SHEET_ID)
      .onFormSubmit()
      .create();

  // فحص صحة يومي الساعة 7 صباحاً
  ScriptApp.newTrigger('dailyHealthCheck_')
      .timeBased()
      .atHour(7)
      .everyDays(1)
      .create();

  // إصلاح بأثر رجعي: ينقل البيانات العالقة حالياً في Master Sheet
  var result = routeFormResponses_();
  Logger.log('تم التنصيب. صفوف نُقلت: ' + result.moved
           + ' | عملاء غير مسجَّلين: ' + result.unknown.join('، '));
  return result;
}

/**
 * دالة تسجيل سريعة — قالب عام. عدّل القيم الأربع وشغّلها لإضافة أي
 * عميل جديد في أقل من دقيقة.
 *
 * حارس: ترفض التشغيل بالقيم الافتراضية دون تعديل، لمنع إنشاء عميل
 * وهمي بالخطأ (كما حدث فعلياً في 09 أغسطس 2026 — راجع
 * cleanupPlaceholderClient_ للتنظيف).
 */
function quickAddClient() {
  var name = 'اسم العميل الجديد'; // الاسم — يجب أن يطابق ما يُكتب في النموذج حرفياً
  var email = '';                  // بريد العميل
  var sector = '';                 // القطاع
  var display = '';                // الاسم الظاهر

  if (name === 'اسم العميل الجديد') {
    throw new Error('عدّل القيم الأربع داخل quickAddClient قبل تشغيلها — لم تُعدَّل بعد.');
  }
  return onboardNewClient_(name, email, sector, display);
}

/**
 * تنظيف العميل الوهمي "اسم العميل الجديد" الذي أُنشئ بالخطأ في
 * 09 أغسطس 2026 بتشغيل quickAddClient بقيمها الافتراضية.
 * يحذف صفه من Master Sheet وينقل ملف سجله إلى سلة المهملات في Drive.
 * شغّلها مرة واحدة ثم يمكن حذف هذه الدالة.
 */
function cleanupPlaceholderClient_() {
  var master = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sheet = master.getSheetByName(TAB_CLIENTS);
  var values = sheet.getDataRange().getValues();

  for (var i = values.length - 1; i >= 1; i--) {
    if (String(values[i][CLIENT_COL_NAME - 1]).trim() === 'اسم العميل الجديد') {
      var sheetId = String(values[i][CLIENT_COL_SHEET_ID - 1]).trim();
      if (sheetId) {
        try {
          DriveApp.getFileById(sheetId).setTrashed(true);
        } catch (err) {
          Logger.log('تعذّر نقل الملف للمهملات: ' + err.message);
        }
      }
      sheet.deleteRow(i + 1);
      Logger.log('تم حذف العميل الوهمي وملفه (كان معرّف السجل: ' + sheetId + ')');
      return { cleaned: true, removedSheetId: sheetId };
    }
  }
  Logger.log('لم يُعثر على عميل باسم "اسم العميل الجديد" — لا شيء للتنظيف.');
  return { cleaned: false };
}

/** يضيف صفوف بيانات الملف التعريفي لعميل موجود مسبقاً (ورقة "ملف العميل"). */
function fillClientProfile_(sheetId, rows) {
  var book = SpreadsheetApp.openById(sheetId);
  var profile = getOrCreateTab_(book, TAB_CLIENT_PROFILE, ['البند', 'القيمة']);
  rows.forEach(function (row) { profile.appendRow(row); });
}

/**
 * تسجيل "وجهة مستثمر — قسم المطاعم" — قسم منفصل تماماً عن عميل
 * "وجهة مستثمر" (الاستشارات، wejhainvest@gmail.com) رغم مشاركة الاسم
 * الأم واسم الشريك "محمد عيسى". اسم مميّز متعمَّد لمنع أي تصادم أو
 * دمج خاطئ بين الملفين في المطابقة الآلية.
 *
 * البيانات مأخوذة حرفياً من استبيان تعريف العميل (مقابلة مباشرة،
 * 2026/08/06، المقابلة مع ميسور).
 */
function onboardWejhaMataem() {
  var result = onboardNewClient_(
      'وجهة مستثمر - قسم المطاعم',      // الاسم — يُستخدم لاحقاً حرفياً في النموذج
      'mmokhtar293@gmail.com',          // بريد استلام التقارير
      'مطاعم وأغذية',                   // القطاع
      'وجهة مستثمر - قسم المطاعم'       // الاسم الظاهر في التقرير
  );

  if (result.sheetId) {
    fillClientProfile_(result.sheetId, [
      ['نوع الكيان', 'شركة'],
      ['القطاع', 'مطاعم وأغذية'],
      ['النشاط', 'تقديم الأكلات الشعبية'],
      ['المدير العام / جهة الاتصال', 'محمد عيسى'],
      ['رقم واتساب مُعبّئ البيانات', '0550665606'],
      ['الهدف المالي الشهري', 'مليون ريال (تقريباً الوضع الحالي)'],
      ['المؤشر الأهم للعميل', 'جميع المؤشرات — بلا استثناء'],
      ['أكبر تحديين', 'زيادة المبيعات — تقليل التكاليف'],
      ['آلية المتابعة السابقة', 'تقارير شهرية يدوية'],
      ['تفضيلات التوصيات', 'التركيز على رفع المبيعات'],
      ['تاريخ المقابلة', '2026/08/06 — المقابلة مع ميسور']
    ]);
  }

  return result;
}

/**
 * تسجيل "وجهة مستثمر — إنجاز المعاملات (نواف طه)" — قسم/تتبّع فردي
 * تحت مظلة "وجهة مستثمر" لكن بقطاع "خدمات" المطابق تماماً لقطاع
 * عميل "وجهة مستثمر" الأصلي (الاستشارات، wejhainvest@gmail.com).
 * التطابق في القطاع يجعل الاسم وحده خط الدفاع الوحيد ضد التصادم في
 * المطابقة الآلية — لذا اسم الشخص المسؤول أُدرج في اسم العميل نفسه
 * وليس في الملف التعريفي فقط.
 *
 * البيانات مأخوذة حرفياً من استبيان تعريف العميل (مقابلة مباشرة،
 * 2026/08/06، المقابلة مع ميسورة).
 */
function onboardWejhaNawaf() {
  var result = onboardNewClient_(
      'وجهة مستثمر - إنجاز المعاملات (نواف طه)',   // الاسم — يُستخدم لاحقاً حرفياً في النموذج
      'noaf712474666@gmail.com',                    // بريد استلام التقارير
      'خدمات',                                       // القطاع
      'وجهة مستثمر - إنجاز المعاملات (نواف طه)'      // الاسم الظاهر في التقرير
  );

  if (result.sheetId) {
    fillClientProfile_(result.sheetId, [
      ['نوع الكيان', 'مؤسسة'],
      ['القطاع', 'خدمات'],
      ['النشاط', 'خدمات عامة'],
      ['المسؤول', 'نواف طه — مشرف فني إنجاز معاملات خدمية'],
      ['رقم واتساب مُعبّئ البيانات', '0521671427'],
      ['الهدف المالي الشهري', 'زيادة الدخل — حالياً 2000'],
      ['المؤشر الأهم للعميل', 'عدد المهام المُنجزة يومياً'],
      ['أكبر تحدٍ', 'ترتيب العمل'],
      ['آلية المتابعة السابقة', 'يكتبها بنفسه يدوياً'],
      ['تفضيلات التوصيات', 'عدم التوسع حالياً'],
      ['تاريخ المقابلة', '2026/08/06 — المقابلة مع ميسورة']
    ]);
  }

  return result;
}
