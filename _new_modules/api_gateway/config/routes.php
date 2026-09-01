<?php

defined('BASEPATH') or exit('No direct script access allowed');

/*
 * این فایل باید همیشه $route را به‌عنوان آرایه تعریف کند - حتی اگر خالی باشد.
 *
 * مسیرهای این ماژول با الگوی استاندارد HMVC پرفکس کار می‌کنند:
 *   - پنل مدیریت: admin/api_gateway/<method>  (کنترلر Api_gateway، نیازمند سشن ادمین)
 *   - endpoint عمومی: api_gateway/dispatch/v1/<path>  (کنترلر Dispatch، بدون سشن، فقط با هدر Authorization: Bearer)
 * نیازی به route سفارشی نیست.
 */
$route = [];
