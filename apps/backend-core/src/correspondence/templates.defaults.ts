export type DefaultTemplate = { name: string; letterType: 'INCOMING' | 'OUTGOING' | 'INTERNAL' | 'ANY'; subject: string; bodyHtml: string; sortOrder: number };

const sign = '<p style="text-align:left">با احترام<br><strong>{{senderName}}</strong><br>{{senderTitle}}</p>';

/** قالب‌های پیش‌فرض سیستم (فقط HTML مجاز پاک‌ساز). */
export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    name: 'نامه‌ی رسمی صادره', letterType: 'OUTGOING', subject: '{{subject}}', sortOrder: 10,
    bodyHtml: '<p><strong>{{recipientTitle}} {{recipientName}}</strong></p><p>با سلام و احترام،</p><p>احتراماً به استحضار می‌رساند ....................</p><p>خواهشمند است دستور فرمایید اقدام لازم معمول گردد.</p>' + sign,
  },
  {
    name: 'دعوت‌نامه', letterType: 'OUTGOING', subject: 'دعوت به ....................', sortOrder: 20,
    bodyHtml: '<p><strong>{{recipientTitle}} {{recipientName}}</strong></p><p>با سلام و احترام،</p><p>بدین‌وسیله از جنابعالی دعوت می‌شود در ....................، در تاریخ .................... ساعت .................... در محل .................... حضور به‌هم رسانید.</p><p>حضور شما موجب سپاس خواهد بود.</p>' + sign,
  },
  {
    name: 'درخواست', letterType: 'OUTGOING', subject: 'درخواست ....................', sortOrder: 30,
    bodyHtml: '<p><strong>{{recipientTitle}} {{recipientName}}</strong></p><p>با سلام و احترام،</p><p>به استحضار می‌رساند .................... لذا خواهشمند است نسبت به .................... اقدام لازم را مبذول فرمایید.</p><p>پیشاپیش از همکاری جنابعالی سپاسگزارم.</p>' + sign,
  },
  {
    name: 'پاسخ به نامه', letterType: 'OUTGOING', subject: 'پاسخ به نامه‌ی شماره‌ی ....................', sortOrder: 40,
    bodyHtml: '<p><strong>{{recipientTitle}} {{recipientName}}</strong></p><p>با سلام و احترام،</p><p>عطف به نامه‌ی شماره‌ی .................... مورخ ....................، به استحضار می‌رساند ....................</p>' + sign,
  },
  {
    name: 'ابلاغیه', letterType: 'OUTGOING', subject: 'ابلاغ ....................', sortOrder: 50,
    bodyHtml: '<p><strong>{{recipientTitle}} {{recipientName}}</strong></p><p>با سلام،</p><p>بدین‌وسیله ابلاغ می‌گردد که از تاریخ {{date}} .................... مقرر شد:</p><ol><li>....................</li><li>....................</li></ol><p>مقتضی است ترتیبی اتخاذ شود که مفاد این ابلاغیه به‌طور کامل اجرا گردد.</p>' + sign,
  },
  {
    name: 'گواهی اشتغال به کار', letterType: 'OUTGOING', subject: 'گواهی اشتغال به کار', sortOrder: 60,
    bodyHtml: '<p><strong>{{recipientTitle}} {{recipientName}}</strong></p><p>گواهی می‌شود آقای/خانم .................... فرزند .................... به شماره‌ی ملی .................... از تاریخ .................... در {{orgName}} در سمت .................... مشغول به کار می‌باشند.</p><p>این گواهی بنا به درخواست ایشان جهت ارائه به .................... صادر شده و فاقد هرگونه ارزش دیگری است.</p>' + sign,
  },
  {
    name: 'یادداشت داخلی', letterType: 'INTERNAL', subject: '{{subject}}', sortOrder: 70,
    bodyHtml: '<p><strong>{{recipientTitle}} {{recipientName}}</strong></p><p>با سلام،</p><p>....................</p><p>با تشکر</p><p style="text-align:left"><strong>{{senderName}}</strong><br>{{senderTitle}}</p>',
  },
];
