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

// ═══ قفل الاعتماد المركزي ═══
// ما دام false: لا يخرج أي بريد لعميل أو مالك إطلاقاً — كل بريد كان
// سيُرسل خارجياً يتحوّل إلى OWNER_EMAIL بعنوان "[معلَّق بانتظار
// الاعتماد]" لتعاينه بنفسك. عند الاعتماد النهائي غيّرها إلى true.
var EXTERNAL_SEND_APPROVED = false;

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

/**
 * الإرسال الخارجي المحكوم بقفل الاعتماد: ما دام EXTERNAL_SEND_APPROVED
 * = false، يتحوّل البريد إليك (OWNER_EMAIL) مع بيان المستلم الأصلي
 * بدل أن يصل العميل. يعيد true فقط إن وصل المستلم الفعلي.
 */
function sendClientEmail_(recipient, subject, htmlBody) {
  if (!EXTERNAL_SEND_APPROVED) {
    MailApp.sendEmail({
      to: getSetting_('OWNER_EMAIL'),
      subject: '[معلَّق بانتظار الاعتماد] ' + subject,
      htmlBody: '<b>⛔ قفل الاعتماد مفعّل — لم يُرسل هذا البريد للمستلم.</b><br>'
              + 'المستلم الأصلي: ' + recipient + '<br>'
              + 'للاعتماد النهائي: غيّر EXTERNAL_SEND_APPROVED إلى true في automation.gs.<br><hr>'
              + htmlBody,
      name: getSetting_('BRAND_NAME')
    });
    return false;
  }
  MailApp.sendEmail({ to: recipient, subject: subject, htmlBody: htmlBody, name: getSetting_('BRAND_NAME') });
  return true;
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
 *
 * الردود التي وصلت بحقل "اسم العميل" الأساسي فارغاً (مثال حقيقي: نواف
 * طه في 09 أغسطس 2026 — ملأ الحقل المكرر في آخر النموذج بدل الأول)
 * تُبلَّغ أيضاً بدل تجاهلها بصمت كما كان يحدث سابقاً.
 */
function routeFormResponses() {
  var master = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var responses = master.getSheetByName(TAB_FORM_RESPONSES).getDataRange().getValues();
  if (responses.length < 2) return { moved: 0, unknown: [], blankName: [] };

  var clients = listClients_();
  var byName = {};
  clients.forEach(function (c) { byName[c.name] = c; });

  var moved = 0;
  var unknown = [];
  var blankName = [];

  for (var i = 1; i < responses.length; i++) {
    var row = responses[i];
    var timestamp  = String(row[0]).trim();  // العمود A: طابع زمني
    var clientName = String(row[1]).trim();  // العمود B: اسم العميل (الحقل الأساسي)
    var dataDate   = normalizeDate_(row[3]); // العمود D: تاريخ البيانات
    var altName    = String(row[14] || '').trim(); // العمود O: حقل "اسم العميل" المكرر في آخر النموذج

    if (!clientName) {
      if (timestamp) {
        blankName.push(timestamp + (altName ? ' — الحقل المكرر يحوي: "' + altName + '"' : ''));
      }
      continue;
    }
    if (!dataDate) continue;

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
          + '\n\nالحل: سجّل العميل عبر onboardNewClient_ ثم أعد تشغيل routeFormResponses.'
    });
  }

  if (blankName.length) {
    MailApp.sendEmail({
      to: getSetting_('OWNER_EMAIL'),
      subject: '[أتمتة مساري] ⚠️ ردود نموذج بحقل "اسم العميل" فارغ',
      body: 'وصلت ردود بحقل "اسم العميل" الأساسي فارغاً، ولن تُنقَل لأي سجل:\n\n'
          + blankName.map(function (b) { return '• ' + b; }).join('\n')
          + '\n\nالسبب المرجّح: العميل استخدم الرابط العام للنموذج بدل رابطه المعبَّأ مسبقاً '
          + '(عمود "رابط النموذج" في ورقة العملاء)، أو ملأ حقلاً مكرراً في آخر النموذج بدل الحقل الأول.\n'
          + 'الحل: أعد إرسال الرابط الصحيح للعميل، أو احذف الصف يدوياً من "ردود النموذج 1" إن كان تجريبياً.'
    });
  }

  return { moved: moved, unknown: unknown, blankName: blankName };
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
  routeFormResponses();
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
  var defaultSheet = book.getSheetByName('Sheet1') || book.getSheetByName('ورقة1') || book.getSheetByName('الورقة1');
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

  // 4) بريد ترحيبي للعميل يحمل رابطه الجاهز (محكوم بقفل الاعتماد)
  if (clientEmail) {
    sendClientEmail_(clientEmail,
      'رابط إدخال بيانات الأداء — ' + getSetting_('BRAND_NAME'),
      'مرحباً ' + (displayName || clientName) + '،<br><br>'
        + 'هذا رابطك الخاص لإدخال بيانات الأداء اليومية:<br>'
        + '<a href="' + formUrl + '">' + formUrl + '</a><br><br>'
        + 'بمجرد أول إدخال ستبدأ تقاريرك بالوصول تلقائياً.<br><br>'
        + getSetting_('SENDER_NAME'));
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
  var routing = routeFormResponses();
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
  var result = routeFormResponses();
  Logger.log('تم التنصيب. صفوف نُقلت: ' + result.moved
           + ' | عملاء غير مسجَّلين: ' + result.unknown.join('، ')
           + ' | ردود بحقل اسم فارغ: ' + result.blankName.length);
  return result;
}

/**
 * دالة تسجيل سريعة — قالب عام. عدّل القيم الأربع وشغّلها لإضافة أي
 * عميل جديد في أقل من دقيقة.
 *
 * حارس: ترفض التشغيل بالقيم الافتراضية دون تعديل، لمنع إنشاء عميل
 * وهمي بالخطأ (كما حدث فعلياً في 09 أغسطس 2026 — راجع
 * cleanupPlaceholderClient للتنظيف).
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
 *
 * ملاحظة: بلا شرطة سفلية في نهاية الاسم عمداً — الشرطة السفلية تخفي
 * الدالة من قائمة "تشغيل" في محرر Apps Script، وهذه الدالة يجب أن
 * تُشغَّل يدوياً.
 */
function cleanupPlaceholderClient() {
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

/* ============ (6) نموذج Google Form مخصص لكل عميل ============ */

/**
 * تصميم مختلف تماماً عن مسار Master Sheet المشترك: لكل عميل هنا نموذج
 * خاص به بالكامل، يكتب مباشرة في سجله الفردي — لا يمر إطلاقاً عبر
 * "ردود النموذج 1" في Master Sheet. هذا يُلغي من أصله فئتي الأخطاء
 * اللتين أصلحناهما سابقاً (اسم غير مطابق / حقل اسم فارغ) لأن العميل
 * لا يكتب اسمه يدوياً في هذا النموذج إطلاقاً — الاسم والقطاع يُكتبان
 * تلقائياً بمعرفة الكود عند كل رد.
 *
 * الأسئلة الثابتة (تطابق ترتيب أعمدة "البيانات اليومية" 4-14) تُبنى
 * دائماً، ثم تُضاف أسئلة العميل الخاصة بعدها بأي عدد يريده.
 *
 * مثال استخدام لعميل موجود مسبقاً:
 *   buildCustomClientForm(
 *     '1OeivQc0nrQq4FPg0rpnxjgKOaFt1XAAB_0JgDEZ4PUA', // معرّف سجل العميل
 *     'وجهة مستثمر',                                    // الاسم كما في Master Sheet
 *     'خدمات',                                           // القطاع
 *     [
 *       { title: 'عدد المكالمات الجادة اليوم', type: 'NUMBER' },
 *       { title: 'اسم أهم عميل محتمل تم التواصل معه اليوم', type: 'TEXT' }
 *     ]
 *   );
 */
function buildCustomClientForm(clientSheetId, clientName, sector, extraQuestions) {
  extraQuestions = extraQuestions || [];

  var form = FormApp.create(clientName + ' — نموذج بيانات مخصص');
  form.setDescription('نموذج بيانات الأداء اليومي — ' + clientName
      + '\nيُملأ يومياً؛ لا حاجة لكتابة اسم العميل، يُسجَّل تلقائياً.');

  form.addDateItem().setTitle('تاريخ البيانات').setRequired(true);
  form.addTextItem().setTitle('إجمالي الإيرادات').setRequired(true);
  form.addTextItem().setTitle('عدد العمليات').setRequired(true);
  form.addTextItem().setTitle('تكلفة البضاعة/التشغيل');
  form.addTextItem().setTitle('عملاء جدد');
  form.addTextItem().setTitle('عملاء متكررون');
  form.addTextItem().setTitle('مصروفات التسويق');
  form.addScaleItem().setTitle('رضا العملاء').setBounds(1, 5);
  form.addTextItem().setTitle('أبرز صنف/خدمة');
  form.addTextItem().setTitle('مؤشر قطاعي إضافي');
  form.addParagraphTextItem().setTitle('ملاحظات اليوم');

  extraQuestions.forEach(function (q) {
    var item;
    switch (q.type) {
      case 'PARAGRAPH':
        item = form.addParagraphTextItem();
        break;
      case 'SCALE':
        item = form.addScaleItem().setBounds(q.min || 1, q.max || 5);
        break;
      case 'MULTIPLE_CHOICE':
        item = form.addMultipleChoiceItem();
        item.setChoiceValues(q.choices || ['نعم', 'لا']);
        break;
      case 'NUMBER':
      case 'TEXT':
      default:
        item = form.addTextItem();
    }
    item.setTitle(q.title).setRequired(!!q.required);
  });

  // الردود الخام تُحفظ في تبويب تلقائي داخل سجل العميل نفسه — للتدقيق فقط
  form.setDestination(FormApp.DestinationType.SPREADSHEET, clientSheetId);

  ScriptApp.newTrigger('onCustomFormSubmit')
      .forForm(form.getId())
      .onFormSubmit()
      .create();

  fillClientProfile_(clientSheetId, [
    ['رابط النموذج المخصص (للعميل)', form.getPublishedUrl()],
    ['رابط تحرير النموذج المخصص (داخلي)', form.getEditUrl()],
    ['عدد الأسئلة الخاصة المضافة', String(extraQuestions.length)]
  ]);

  var client = listClients_().filter(function (c) { return c.sheetId === clientSheetId; })[0];
  if (client) {
    // محكوم بقفل الاعتماد — لن يصل العميل قبل موافقتك النهائية
    sendClientEmail_(client.email,
      'نموذجك الخاص لإدخال بيانات الأداء — ' + getSetting_('BRAND_NAME'),
      'مرحباً ' + (client.display || clientName) + '،<br><br>'
        + 'هذا نموذجك المخصص لإدخال بياناتك اليومية:<br>'
        + '<a href="' + form.getPublishedUrl() + '">' + form.getPublishedUrl() + '</a><br><br>'
        + 'لا حاجة لكتابة اسمك — يُسجَّل تلقائياً مع كل رد.<br><br>'
        + getSetting_('SENDER_NAME'));
  }

  Logger.log('تم إنشاء النموذج المخصص: ' + form.getPublishedUrl());
  return { formUrl: form.getPublishedUrl(), editUrl: form.getEditUrl(), formId: form.getId() };
}

/**
 * معالج موحّد لكل النماذج المخصصة — لا يحتاج معرفة أي عميل أرسل الرد؛
 * يكتشف ذلك من ملف السجل الذي كُتب فيه الرد الخام مباشرة (نفس ملف
 * العميل الذي رُبط النموذج به عبر setDestination)، ثم يطابقه بمعرّف
 * السجل في Master Sheet لجلب الاسم والقطاع الصحيحين.
 */
function onCustomFormSubmit(e) {
  var clientBook = e.range.getSheet().getParent();
  var clientSheetId = clientBook.getId();

  var client = listClients_().filter(function (c) { return c.sheetId === clientSheetId; })[0];
  if (!client) {
    MailApp.sendEmail({
      to: getSetting_('OWNER_EMAIL'),
      subject: '[أتمتة مساري] ⚠️ رد نموذج مخصص من سجل غير مُطابَق',
      body: 'وصل رد نموذج مخصص لملف (' + clientBook.getUrl() + ') لكن لا يوجد عميل بهذا '
          + 'المعرّف في Master Sheet. راجع الأمر يدوياً.'
    });
    return;
  }

  var values = e.values; // [الطابع الزمني, تاريخ البيانات, إيرادات, عمليات, ...ثم الأسئلة الخاصة]
  var dataDate = normalizeDate_(values[1]);

  var daily = getOrCreateTab_(clientBook, TAB_CLIENT_DAILY, [
    'الطابع الزمني', 'اسم العميل', 'القطاع', 'تاريخ البيانات',
    'إجمالي الإيرادات', 'عدد العمليات', 'تكلفة البضاعة/التشغيل',
    'عملاء جدد', 'عملاء متكررون', 'مصروفات التسويق', 'رضا العملاء',
    'أبرز صنف/خدمة', 'مؤشر قطاعي إضافي', 'ملاحظات اليوم'
  ]);

  if (dailyRowExists_(daily, dataDate)) return; // حارس ضد التكرار

  // الأعمدة الثابتة الإحدى عشرة الأولى (values[1..11]) تطابق ترتيب البناء في
  // buildCustomClientForm؛ أي أسئلة خاصة إضافية تقع بعدها في values[12..]
  var fixedAnswers = values.slice(1, 12);
  var row = [values[0], client.name, client.sector].concat(fixedAnswers);
  daily.appendRow(row);
  markClientActive_(client.rowIndex);

  var customAnswers = values.slice(12);
  if (customAnswers.length) {
    var customTab = getOrCreateTab_(clientBook, 'بيانات مخصّصة', ['الطابع الزمني', 'تاريخ البيانات', 'الإجابات الخاصة']);
    customTab.appendRow([values[0], values[1], customAnswers.join(' | ')]);
  }
}

/* ============ (7) تجربة المالك: نموذج أولي كامل بنقرة واحدة ============ */

/**
 * تجربة كاملة للنموذج المخصص قبل اعتماده مع عملاء حقيقيين.
 * شغّلها مرة واحدة، وخلال دقيقة يصلك على hezmai039@gmail.com بريد
 * فيه رابط نموذج تجريبي حقيقي — عبّئه بنفسك وراقب انتقال البيانات
 * تلقائياً إلى سجل تجريبي منفصل.
 *
 * كل شيء معزول عن عملائك الحقيقيين:
 * - سجل تجريبي مستقل باسم "سجل - تجربة داخلية (مساري)"
 * - لا يُسجَّل في Master Sheet إطلاقاً — لن يستلم تقارير ولن يظهر
 *   في الفحص اليومي
 * - بعد انتهاء التجربة شغّل deleteOwnerTest لمحو كل أثر لها
 */
function runOwnerTest() {
  var TEST_EMAIL = 'hezmai425@gmail.com';
  var TEST_NAME  = 'تجربة داخلية (مساري)';

  // 1) سجل تجريبي معزول في نفس مجلد المشروع
  var folder = DriveApp.getFileById(MASTER_SHEET_ID).getParents().next();
  var book = SpreadsheetApp.create('سجل - ' + TEST_NAME);
  var bookFile = DriveApp.getFileById(book.getId());
  folder.addFile(bookFile);
  DriveApp.getRootFolder().removeFile(bookFile);

  getOrCreateTab_(book, TAB_CLIENT_DAILY, [
    'الطابع الزمني', 'اسم العميل', 'القطاع', 'تاريخ البيانات',
    'إجمالي الإيرادات', 'عدد العمليات', 'تكلفة البضاعة/التشغيل',
    'عملاء جدد', 'عملاء متكررون', 'مصروفات التسويق', 'رضا العملاء',
    'أبرز صنف/خدمة', 'مؤشر قطاعي إضافي', 'ملاحظات اليوم'
  ]);
  getOrCreateTab_(book, TAB_CLIENT_ARCHIVE,
      ['تاريخ الإرسال', 'نوع التقرير', 'الفترة', 'حالة الإرسال']);
  getOrCreateTab_(book, TAB_CLIENT_PROFILE, ['البند', 'القيمة']);
  var defaultSheet = book.getSheetByName('Sheet1') || book.getSheetByName('ورقة1') || book.getSheetByName('الورقة1');
  if (defaultSheet && book.getSheets().length > 1) book.deleteSheet(defaultSheet);

  // 2) نموذج مخصص تجريبي بسؤالين خاصين كمثال حي
  var form = FormApp.create(TEST_NAME + ' — نموذج بيانات مخصص');
  form.setDescription('نموذج تجريبي — عبّئه بأي أرقام وراقب انتقالها تلقائياً لسجل التجربة.');

  form.addDateItem().setTitle('تاريخ البيانات').setRequired(true);
  form.addTextItem().setTitle('إجمالي الإيرادات').setRequired(true);
  form.addTextItem().setTitle('عدد العمليات').setRequired(true);
  form.addTextItem().setTitle('تكلفة البضاعة/التشغيل');
  form.addTextItem().setTitle('عملاء جدد');
  form.addTextItem().setTitle('عملاء متكررون');
  form.addTextItem().setTitle('مصروفات التسويق');
  form.addScaleItem().setTitle('رضا العملاء').setBounds(1, 5);
  form.addTextItem().setTitle('أبرز صنف/خدمة');
  form.addTextItem().setTitle('مؤشر قطاعي إضافي');
  form.addParagraphTextItem().setTitle('ملاحظات اليوم');
  // سؤالان خاصان — مثال حي على التخصيص لكل عميل
  form.addTextItem().setTitle('سؤال خاص 1: عدد المكالمات الجادة اليوم');
  form.addTextItem().setTitle('سؤال خاص 2: أهم إنجاز اليوم');

  form.setDestination(FormApp.DestinationType.SPREADSHEET, book.getId());

  ScriptApp.newTrigger('onOwnerTestFormSubmit')
      .forForm(form.getId())
      .onFormSubmit()
      .create();

  // 3) حفظ المعرّفات في سجل التجربة نفسه (تُستخدم للمعالجة والتنظيف لاحقاً)
  fillClientProfile_(book.getId(), [
    ['رابط النموذج التجريبي', form.getPublishedUrl()],
    ['رابط تحرير النموذج', form.getEditUrl()],
    ['معرّف النموذج', form.getId()],
    ['ملاحظة', 'سجل تجريبي معزول — غير مسجَّل في Master Sheet']
  ]);
  PropertiesService.getScriptProperties().setProperties({
    OWNER_TEST_SHEET_ID: book.getId(),
    OWNER_TEST_FORM_ID: form.getId()
  });

  // 4) البريد لك
  MailApp.sendEmail({
    to: TEST_EMAIL,
    subject: '🧪 نموذجك التجريبي جاهز — ' + getSetting_('BRAND_NAME'),
    htmlBody: 'مرحباً،<br><br>'
            + 'هذا النموذج الأولي للتجربة قبل الاعتماد:<br>'
            + '<a href="' + form.getPublishedUrl() + '">' + form.getPublishedUrl() + '</a><br><br>'
            + '<b>خطوات التجربة:</b><br>'
            + '1. عبّئ النموذج بأي أرقام تجريبية.<br>'
            + '2. افتح سجل التجربة وراقب وصول البيانات تلقائياً لورقة "البيانات اليومية" '
            + 'مع الاسم والقطاع مكتوبين آلياً (لن تكتبهما أنت):<br>'
            + '<a href="' + book.getUrl() + '">' + book.getUrl() + '</a><br>'
            + '3. لاحظ السؤالين الخاصين في آخر النموذج — إجاباتهما تصل تبويب "بيانات مخصّصة" المنفصل.<br><br>'
            + 'بعد اقتناعك، شغّل deleteOwnerTest من المحرر لمحو التجربة بالكامل.<br><br>'
            + getSetting_('SENDER_NAME'),
    name: getSetting_('BRAND_NAME')
  });

  Logger.log('تمت التجربة. النموذج: ' + form.getPublishedUrl() + ' | السجل: ' + book.getUrl());
  return { formUrl: form.getPublishedUrl(), sheetUrl: book.getUrl() };
}

/**
 * معالج ردود النموذج التجريبي — نفس منطق onCustomFormSubmit لكن باسم
 * العميل التجريبي الثابت، دون الحاجة لتسجيله في Master Sheet.
 */
function onOwnerTestFormSubmit(e) {
  var book = e.range.getSheet().getParent();
  var values = e.values;
  var dataDate = normalizeDate_(values[1]);

  var daily = getOrCreateTab_(book, TAB_CLIENT_DAILY, [
    'الطابع الزمني', 'اسم العميل', 'القطاع', 'تاريخ البيانات',
    'إجمالي الإيرادات', 'عدد العمليات', 'تكلفة البضاعة/التشغيل',
    'عملاء جدد', 'عملاء متكررون', 'مصروفات التسويق', 'رضا العملاء',
    'أبرز صنف/خدمة', 'مؤشر قطاعي إضافي', 'ملاحظات اليوم'
  ]);
  if (dailyRowExists_(daily, dataDate)) return;

  var fixedAnswers = values.slice(1, 12);
  daily.appendRow([values[0], 'تجربة داخلية (مساري)', 'تجريبي'].concat(fixedAnswers));

  var customAnswers = values.slice(12);
  if (customAnswers.length) {
    var customTab = getOrCreateTab_(book, 'بيانات مخصّصة',
        ['الطابع الزمني', 'تاريخ البيانات', 'الإجابات الخاصة']);
    customTab.appendRow([values[0], values[1], customAnswers.join(' | ')]);
  }
}

/**
 * محو التجربة بالكامل بعد انتهائها: النموذج، السجل، والمشغّل.
 */
function deleteOwnerTest() {
  var props = PropertiesService.getScriptProperties();
  var sheetId = props.getProperty('OWNER_TEST_SHEET_ID');
  var formId = props.getProperty('OWNER_TEST_FORM_ID');

  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'onOwnerTestFormSubmit') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  if (formId) {
    try { DriveApp.getFileById(formId).setTrashed(true); } catch (err) {}
  }
  if (sheetId) {
    try { DriveApp.getFileById(sheetId).setTrashed(true); } catch (err) {}
  }
  props.deleteProperty('OWNER_TEST_SHEET_ID');
  props.deleteProperty('OWNER_TEST_FORM_ID');
  Logger.log('تم محو التجربة بالكامل: النموذج والسجل والمشغّل.');
}

/* ============ (8) حوكمة إدارة مساري: توثيق يومي للملاك ============ */

/**
 * وحدة حوكمة مستقلة عن منصة العملاء بالكامل: استبيان يومي يعبّئه
 * المدير التنفيذي بنفسه، يوثّق كل جوانب إدارة شركة مساري (عمليات
 * العملاء، المبيعات، المالية، الفريق، القرارات والمخاطر) في سجل
 * حوكمة دائم — دليل موثَّق بطوابع زمنية أمام الملاك على جدية
 * وانضباط آلية العمل.
 *
 * شغّل setupMasariGovernance مرة واحدة: تنشئ السجل والنموذج
 * والمشغّل، وترسل الرابط لبريدك. لمنح الملاك اطلاعاً مباشراً،
 * أضف بريداً في OWNERS_VIEWER_EMAILS قبل التشغيل (أو لاحقاً يدوياً
 * عبر مشاركة السجل كقارئ Viewer).
 */

var GOVERNANCE_SHEET_NAME = 'سجل حوكمة - مساري';
var TAB_GOV_DAILY = 'السجل اليومي';

// أبرِدة الملاك الذين يُمنحون اطلاعاً للقراءة فقط على سجل الحوكمة.
// اتركها فارغة الآن وأضِفها لاحقاً عند جاهزيتك لمشاركة السجل.
var OWNERS_VIEWER_EMAILS = [];

var GOV_HEADERS = [
  'الطابع الزمني', 'تاريخ اليوم',
  // عمليات العملاء
  'عدد العملاء النشطين', 'تقارير أُرسلت للعملاء اليوم', 'شكاوى أو مشاكل عملاء',
  // المبيعات والنمو
  'عملاء محتملون جدد تم التواصل معهم', 'اجتماعات ومكالمات جادة', 'عقود جديدة (عدد وقيمة)',
  // المالية
  'إيرادات محصَّلة اليوم', 'مصروفات اليوم', 'مستحقات معلَّقة',
  // الفريق والتشغيل
  'مهام مخطَّطة أُنجزت', 'معوقات تشغيلية',
  // الحوكمة والقرارات
  'قرارات إدارية اتُّخذت اليوم', 'مخاطر جديدة أو ملاحظات التزام',
  'تقييم ذاتي لالتزام اليوم بالخطة (1-5)',
  // التخطيط
  'خطة الغد'
];

function setupMasariGovernance() {
  var MY_EMAIL = 'hezmai425@gmail.com';

  // 1) سجل الحوكمة في نفس مجلد المشروع
  var folder = DriveApp.getFileById(MASTER_SHEET_ID).getParents().next();
  var book = SpreadsheetApp.create(GOVERNANCE_SHEET_NAME);
  var bookFile = DriveApp.getFileById(book.getId());
  folder.addFile(bookFile);
  DriveApp.getRootFolder().removeFile(bookFile);

  getOrCreateTab_(book, TAB_GOV_DAILY, GOV_HEADERS);
  getOrCreateTab_(book, 'ميثاق الحوكمة', ['البند', 'القيمة']);
  var defaultSheet = book.getSheetByName('Sheet1') || book.getSheetByName('ورقة1') || book.getSheetByName('الورقة1');
  if (defaultSheet && book.getSheets().length > 1) book.deleteSheet(defaultSheet);

  var charter = book.getSheetByName('ميثاق الحوكمة');
  [
    ['الغرض', 'توثيق يومي مُلزم لإدارة شركة مساري أمام الملاك — دليل جدية وانضباط آلية العمل'],
    ['المسؤول عن التعبئة', getSetting_('SENDER_NAME')],
    ['وتيرة التعبئة', 'يومياً بنهاية يوم العمل'],
    ['قاعدة الطوابع الزمنية', 'كل صف يُسجَّل آلياً بطابع زمني لا يمكن تعديله عبر النموذج — أي تأخير أو انقطاع يظهر تلقائياً'],
    ['اطلاع الملاك', 'قراءة فقط عبر مشاركة هذا السجل (Viewer)'],
    ['تاريخ التفعيل', Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/MM/dd')]
  ].forEach(function (row) { charter.appendRow(row); });

  // 2) استبيان الحوكمة اليومي — الأسئلة تطابق GOV_HEADERS بالترتيب
  var form = FormApp.create('حوكمة مساري — الاستبيان الإداري اليومي');
  form.setDescription('يُعبَّأ يومياً بنهاية يوم العمل من المدير التنفيذي.\n'
      + 'كل رد يُسجَّل بطابع زمني دائم في سجل الحوكمة المتاح للملاك للقراءة.');

  form.addDateItem().setTitle('تاريخ اليوم').setRequired(true);

  form.addSectionHeaderItem().setTitle('أولاً — عمليات العملاء');
  form.addTextItem().setTitle('عدد العملاء النشطين').setRequired(true);
  form.addTextItem().setTitle('تقارير أُرسلت للعملاء اليوم').setRequired(true);
  form.addParagraphTextItem().setTitle('شكاوى أو مشاكل عملاء');

  form.addSectionHeaderItem().setTitle('ثانياً — المبيعات والنمو');
  form.addTextItem().setTitle('عملاء محتملون جدد تم التواصل معهم').setRequired(true);
  form.addTextItem().setTitle('اجتماعات ومكالمات جادة');
  form.addTextItem().setTitle('عقود جديدة (عدد وقيمة)');

  form.addSectionHeaderItem().setTitle('ثالثاً — المالية');
  form.addTextItem().setTitle('إيرادات محصَّلة اليوم').setRequired(true);
  form.addTextItem().setTitle('مصروفات اليوم').setRequired(true);
  form.addTextItem().setTitle('مستحقات معلَّقة');

  form.addSectionHeaderItem().setTitle('رابعاً — الفريق والتشغيل');
  form.addTextItem().setTitle('مهام مخطَّطة أُنجزت');
  form.addParagraphTextItem().setTitle('معوقات تشغيلية');

  form.addSectionHeaderItem().setTitle('خامساً — الحوكمة والقرارات');
  form.addParagraphTextItem().setTitle('قرارات إدارية اتُّخذت اليوم');
  form.addParagraphTextItem().setTitle('مخاطر جديدة أو ملاحظات التزام');
  form.addScaleItem().setTitle('تقييم ذاتي لالتزام اليوم بالخطة (1-5)').setBounds(1, 5).setRequired(true);

  form.addSectionHeaderItem().setTitle('سادساً — التخطيط');
  form.addParagraphTextItem().setTitle('خطة الغد').setRequired(true);

  form.setDestination(FormApp.DestinationType.SPREADSHEET, book.getId());

  ScriptApp.newTrigger('onGovernanceFormSubmit')
      .forForm(form.getId())
      .onFormSubmit()
      .create();

  PropertiesService.getScriptProperties().setProperties({
    GOVERNANCE_SHEET_ID: book.getId(),
    GOVERNANCE_FORM_ID: form.getId()
  });

  // 3) اطلاع الملاك (قراءة فقط) — محكوم بقفل الاعتماد أيضاً
  if (EXTERNAL_SEND_APPROVED) {
    OWNERS_VIEWER_EMAILS.forEach(function (email) {
      try { bookFile.addViewer(email); } catch (err) {
        Logger.log('تعذّرت مشاركة السجل مع ' + email + ': ' + err.message);
      }
    });
  } else if (OWNERS_VIEWER_EMAILS.length) {
    Logger.log('قفل الاعتماد مفعّل — لم يُشارَك السجل مع الملاك بعد ('
        + OWNERS_VIEWER_EMAILS.join('، ') + ').');
  }

  // 4) البريد لك برابطي النموذج والسجل
  MailApp.sendEmail({
    to: MY_EMAIL,
    subject: '🏛️ وحدة حوكمة مساري جاهزة — ' + getSetting_('BRAND_NAME'),
    htmlBody: 'تم تفعيل وحدة الحوكمة الإدارية.<br><br>'
            + '<b>استبيانك اليومي (يُعبَّأ بنهاية كل يوم عمل):</b><br>'
            + '<a href="' + form.getPublishedUrl() + '">' + form.getPublishedUrl() + '</a><br><br>'
            + '<b>سجل الحوكمة (هذا ما يراه الملاك):</b><br>'
            + '<a href="' + book.getUrl() + '">' + book.getUrl() + '</a><br><br>'
            + 'كل رد يُسجَّل بطابع زمني آلي دائم — الانتظام نفسه يصبح دليلاً.<br>'
            + 'لمنح الملاك الاطلاع: شارك السجل معهم كقارئ (Viewer) من زر المشاركة.<br><br>'
            + getSetting_('SENDER_NAME'),
    name: getSetting_('BRAND_NAME')
  });

  Logger.log('تم التفعيل. الاستبيان: ' + form.getPublishedUrl() + ' | السجل: ' + book.getUrl());
  return { formUrl: form.getPublishedUrl(), sheetUrl: book.getUrl() };
}

/**
 * معالج استبيان الحوكمة — ينسخ كل رد إلى "السجل اليومي" المنظَّم،
 * مع حارس ضد تكرار نفس اليوم.
 */
function onGovernanceFormSubmit(e) {
  var book = e.range.getSheet().getParent();
  var values = e.values; // [الطابع الزمني, تاريخ اليوم, ...الإجابات بترتيب الأسئلة]
  var dataDate = normalizeDate_(values[1]);

  var daily = getOrCreateTab_(book, TAB_GOV_DAILY, GOV_HEADERS);

  var existing = daily.getDataRange().getValues();
  for (var i = 1; i < existing.length; i++) {
    if (normalizeDate_(existing[i][1]) === dataDate) return; // رُصد هذا اليوم مسبقاً
  }

  daily.appendRow(values.slice(0, GOV_HEADERS.length));
}
