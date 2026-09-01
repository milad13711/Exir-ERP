<?php

defined('BASEPATH') or exit('No direct script access allowed');

$lang['api_gateway_menu_name']      = 'دروازه API';
$lang['api_gateway_menu_tokens']    = 'توکن‌ها';
$lang['api_gateway_menu_endpoints'] = 'مستندات API';
$lang['api_gateway_menu_logs']      = 'لاگ درخواست‌ها';
$lang['api_gateway_menu_webhooks']  = 'Webhook خروجی';

$lang['api_gateway_cap_view']            = 'مشاهده';
$lang['api_gateway_cap_manage_tokens']   = 'مدیریت توکن‌ها';
$lang['api_gateway_cap_manage_webhooks'] = 'مدیریت Webhookها';

$lang['api_gateway_active_tokens']         = 'توکن فعال';
$lang['api_gateway_registered_endpoints']  = 'endpoint ثبت‌شده';
$lang['api_gateway_modules']                = 'ماژول';
$lang['api_gateway_requests_today']        = 'درخواست امروز';
$lang['api_gateway_recent_requests']       = 'آخرین درخواست‌ها';
$lang['api_gateway_view_all_logs']         = 'مشاهده کامل لاگ‌ها';

$lang['api_gateway_col_time']     = 'زمان';
$lang['api_gateway_col_method']   = 'متد';
$lang['api_gateway_col_path']     = 'مسیر';
$lang['api_gateway_col_module']   = 'ماژول';
$lang['api_gateway_col_status']   = 'وضعیت';
$lang['api_gateway_col_duration'] = 'زمان پاسخ';
$lang['api_gateway_col_ip']       = 'IP';
$lang['api_gateway_col_description'] = 'توضیح';

$lang['api_gateway_new_token']              = 'توکن جدید';
$lang['api_gateway_token_name']             = 'نام توکن';
$lang['api_gateway_token_name_placeholder'] = 'مثلاً: ایجنت شخصی من';
$lang['api_gateway_acting_staff']           = 'کارمند نماینده';
$lang['api_gateway_acting_staff_none']      = 'بدون کارمند خاص (سیستمی)';
$lang['api_gateway_acting_staff_hint']      = 'رکوردهایی که این توکن می‌سازد (فاکتور، تسک و...) به نام همین کارمند ثبت می‌شوند - مثل این‌که خودش وارد پنل شده و آن‌ها را ساخته باشد.';
$lang['api_gateway_token_scope']            = 'سطح دسترسی';
$lang['api_gateway_scope_all']              = 'دسترسی به همه ماژول‌ها و هسته';
$lang['api_gateway_scope_custom']           = 'فقط ماژول‌های انتخابی';
$lang['api_gateway_token_preview']          = 'توکن';
$lang['api_gateway_last_used']              = 'آخرین استفاده';
$lang['api_gateway_revoke']                 = 'ابطال';
$lang['api_gateway_revoked']                = 'ابطال‌شده';
$lang['api_gateway_active']                 = 'فعال';
$lang['api_gateway_inactive']               = 'غیرفعال';
$lang['api_gateway_confirm_revoke']         = 'این توکن ابطال شود؟ هر ابزاری که با آن وصل است بلافاصله دسترسی را از دست می‌دهد.';
$lang['api_gateway_token_created']          = 'توکن ساخته شد';
$lang['api_gateway_token_revoked']          = 'توکن ابطال شد';
$lang['api_gateway_token_show_once_title']  = 'این توکن را همین حالا کپی کنید';
$lang['api_gateway_token_show_once_body']   = 'این تنها فرصت شما برای دیدن توکن کامل است - بعد از بستن این پیام، فقط ۴ کاراکتر آخر آن در لیست قابل مشاهده خواهد بود (خودِ سیستم هم آن را ذخیره نمی‌کند، فقط یک نسخه‌ی رمزنگاری‌شده که قابل بازگردانی نیست).';
$lang['api_gateway_copy']                   = 'کپی';

$lang['api_gateway_base_url_hint']    = 'آدرس پایه‌ی همه‌ی endpointها (برای اتصال کانکتور/ایجنت، همین آدرس + مسیر جدول زیر + هدر Authorization: Bearer &lt;توکن&gt;):';
$lang['api_gateway_webhook_events']   = 'رویدادهای مرتبط';

$lang['api_gateway_new_webhook']                = 'Webhook جدید';
$lang['api_gateway_webhook_name']               = 'نام';
$lang['api_gateway_webhook_event_pattern']      = 'الگوی رویداد';
$lang['api_gateway_webhook_event_pattern_hint'] = 'مثال: module_name.* برای همه رویدادهای یک ماژول، module_name.event_name برای یک رویداد خاص، یا * برای همه‌چیز.';
$lang['api_gateway_webhook_url']                = 'آدرس (URL)';
$lang['api_gateway_webhook_secret']             = 'کلید امضا (اختیاری)';
$lang['api_gateway_webhook_secret_hint']        = 'اگر پر شود، هر درخواست با هدر X-Api-Gateway-Signature (HMAC-SHA256) امضا می‌شود تا سیستم مقصد بتواند اصالت آن را تایید کند.';

// راهنمای صفحات — استاندارد یکپارچه (دکمه اولین pull-right + مودال + مثال عملی)
$lang['api_gateway_help_btn'] = 'راهنما';

$lang['api_gateway_help_title_index'] = 'راهنمای دروازه API';
$lang['api_gateway_help_body_index'] = '
<ol>
  <li>«دروازه API» یک نقطه‌ی ورود واحد برای اتصال ابزارهای بیرونی (مثل یک ایجنت هوش مصنوعی شخصی از طریق کانکتور MCP) به هسته‌ی پرفکس و همه‌ی ماژول‌های نصب‌شده است.</li>
  <li>ابتدا از صفحه‌ی «توکن‌ها» یک توکن دسترسی بسازید، بعد از صفحه‌ی «مستندات API» آدرس دقیق هر endpoint را کپی کنید.</li>
  <li>هر درخواست ورودی/خروجی در «لاگ درخواست‌ها» ثبت می‌شود تا در صورت رفتار غیرمنتظره‌ی یک ابزار متصل، بتوانید دقیقاً ببینید چه چیزی صدا زده شده.</li>
</ol>
<div class="alert alert-info" style="margin-top:14px;">
  <strong><i class="fa fa-lightbulb-o"></i> مثال:</strong>
  می‌خواهید یک ایجنت شخصی را از طریق MCP به CRM وصل کنید. یک توکن با نام «ایجنت شخصی من» بسازید، آن را در تنظیمات کانکتور MCP وارد کنید - از این پس ایجنت می‌تواند مشتری/سرنخ/فاکتور و داده‌های ماژول‌های دیگر را بخواند و بنویسد.
</div>
';

$lang['api_gateway_help_title_tokens'] = 'راهنمای توکن‌های دسترسی';
$lang['api_gateway_help_body_tokens'] = '
<ol>
  <li>هر توکن یک کلید مخفی است که به‌جای رمز عبور، هویت یک ابزار بیرونی (نه یک کارمند) را تایید می‌کند.</li>
  <li>می‌توانید دسترسی هر توکن را به چند ماژول خاص محدود کنید - مثلاً یک توکن فقط برای «انبار» و «مدیریت سفارشات»، بدون دسترسی به حسابداری.</li>
  <li>توکن فقط یک‌بار، همان لحظه‌ی ساخت، به‌طور کامل نمایش داده می‌شود؛ بعد از آن فقط ۴ کاراکتر آخرش برای تشخیص در لیست باقی می‌ماند - اگر گم شد، باید یک توکن جدید بسازید.</li>
  <li>«ابطال» توکن را غیرفعال می‌کند بدون حذف تاریخچه‌ی لاگ آن؛ «حذف» رکورد را کامل پاک می‌کند.</li>
</ol>
<div class="alert alert-info" style="margin-top:14px;">
  <strong><i class="fa fa-lightbulb-o"></i> مثال:</strong>
  می‌خواهید یک ابزار گزارش‌گیری بیرونی فقط بتواند فاکتورها را بخواند، نه چیز دیگری را تغییر دهد. یک توکن با دسترسی سفارشی فقط روی ماژول «core» بسازید و به همان ابزار بدهید.
</div>
';

$lang['api_gateway_help_title_endpoints'] = 'راهنمای مستندات API';
$lang['api_gateway_help_body_endpoints'] = '
<ol>
  <li>این صفحه خودکار از روی همان چیزی که هر ماژول واقعاً ثبت کرده ساخته می‌شود - هیچ‌وقت با کد واقعی ناهماهنگ نمی‌شود.</li>
  <li>هر ردیف یعنی یک عملیات قابل‌فراخوانی: متد HTTP (GET برای خواندن، POST برای ساختن، ...)، آدرس کامل، و توضیح کوتاه.</li>
</ol>
<div class="alert alert-info" style="margin-top:14px;">
  <strong><i class="fa fa-lightbulb-o"></i> مثال:</strong>
  می‌خواهید بدانید چطور یک فاکتور جدید بسازید؟ ردیف با متد POST و مسیر core/invoices را پیدا کنید - همراه با توکن، دقیقاً همان آدرس را با اطلاعات مشتری و اقلام صدا بزنید.
</div>
';

$lang['api_gateway_help_title_logs'] = 'راهنمای لاگ درخواست‌ها';
$lang['api_gateway_help_body_logs'] = '
<ol>
  <li>هر درخواستی که از طریق دروازه API انجام شده - موفق یا ناموفق - این‌جا با زمان، توکن، مسیر و کد وضعیت ثبت می‌شود.</li>
  <li>اگر یک ابزار بیرونی رفتار غیرمنتظره‌ای داشت (مثلاً خطای مکرر)، اینجا می‌توانید پیام خطای دقیق را ببینید.</li>
</ol>
<div class="alert alert-info" style="margin-top:14px;">
  <strong><i class="fa fa-lightbulb-o"></i> مثال:</strong>
  ایجنت شما گزارش می‌دهد فاکتور ساخته نشده. اینجا آخرین درخواست‌های همان توکن را فیلتر کنید و کد وضعیت/پیام خطا را بررسی کنید.
</div>
';

$lang['api_gateway_help_title_webhooks'] = 'راهنمای Webhook خروجی';
$lang['api_gateway_help_body_webhooks'] = '
<ol>
  <li>به‌جای این‌که یک ابزار بیرونی مدام بپرسد «چیزی تغییر کرده؟» (polling)، رویدادهای مهم CRM همان لحظه با یک POST به آدرس شما ارسال می‌شوند.</li>
  <li>الگوی رویداد می‌تواند دقیق (یک رویداد خاص)، با ستاره در انتها (همه‌ی رویدادهای یک ماژول)، یا فقط `*` (همه‌چیز) باشد.</li>
  <li>اگر کلید امضا وارد کنید، سیستم مقصد می‌تواند با محاسبه‌ی HMAC-SHA256 روی بدنه‌ی درخواست، مطمئن شود درخواست واقعاً از این CRM آمده.</li>
</ol>
<div class="alert alert-info" style="margin-top:14px;">
  <strong><i class="fa fa-lightbulb-o"></i> مثال:</strong>
  می‌خواهید هر بار سند حسابداری تایید شد، سیستم گزارش‌گیری بیرونی‌تان مطلع شود. یک Webhook با الگوی رویداد «exir_accounting.document_confirmed» و آدرس سرویس خودتان بسازید.
</div>
';
