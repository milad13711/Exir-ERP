<?php

defined('BASEPATH') or exit('No direct script access allowed');

/*
Module Name: دروازه API (API Gateway)
Description: نقطه‌ی ورود واحد و امن برای اتصال ابزارهای بیرونی (از جمله کانکتور MCP/ایجنت شخصی) به هسته‌ی پرفکس و همه‌ی ماژول‌های اکسیر - احراز هویت یکپارچه با توکن مبتنی بر scope، لاگ مرکزی هر درخواست، و registry مشترکی که هر ماژول endpoint خودش را در آن معرفی می‌کند.
Version: 1.0.0
Author: Exir Tejarat
Author URI:
*/

define('API_GATEWAY_MODULE_NAME', 'api_gateway');
define('API_GATEWAY_SCHEMA_VERSION', 1);

/* ------------------------------------------------------------------ */
/* Activation: ساخت جدول‌ها                                            */
/* ------------------------------------------------------------------ */
register_activation_hook(API_GATEWAY_MODULE_NAME, 'api_gateway_activation_hook');
function api_gateway_activation_hook()
{
    $CI = &get_instance();
    $charset = $CI->db->char_set;
    $p = db_prefix();

    if (!$CI->db->table_exists($p . 'api_gateway_tokens')) {
        $CI->db->query('CREATE TABLE `' . $p . "api_gateway_tokens` (
            `id` int(11) NOT NULL AUTO_INCREMENT,
            `name` varchar(191) NOT NULL,
            `token_hash` char(64) NOT NULL COMMENT 'sha256 - خودِ توکن هرگز ذخیره نمی‌شود',
            `token_preview` varchar(12) NOT NULL COMMENT '۴ کاراکتر آخر واقعی، برای تشخیص در لیست بدون افشای کامل توکن',
            `scopes` text NOT NULL COMMENT 'لیست اسم ماژول‌های مجاز، جدا با کاما، یا * برای همه',
            `acting_staff_id` int(11) NULL DEFAULT NULL COMMENT 'رکوردهایی که این توکن می‌سازد (فاکتور/تسک و...) به نام همین کارمند ثبت می‌شوند - بدون این، مفهوم addedfrom/sale_agent هسته برای یک درخواست بدون سشن معنی ندارد',
            `status` enum('active','revoked') NOT NULL DEFAULT 'active',
            `created_by` int(11) NULL DEFAULT NULL,
            `created_at` datetime NOT NULL,
            `last_used_at` datetime NULL DEFAULT NULL,
            `last_used_ip` varchar(64) NULL DEFAULT NULL,
            `revoked_at` datetime NULL DEFAULT NULL,
            PRIMARY KEY (`id`),
            UNIQUE KEY `token_hash` (`token_hash`)
        ) ENGINE=InnoDB DEFAULT CHARSET=" . $charset . ';');
    }

    if (!$CI->db->table_exists($p . 'api_gateway_logs')) {
        $CI->db->query('CREATE TABLE `' . $p . "api_gateway_logs` (
            `id` int(11) NOT NULL AUTO_INCREMENT,
            `token_id` int(11) NULL DEFAULT NULL,
            `method` varchar(10) NOT NULL,
            `path` varchar(255) NOT NULL,
            `module_name` varchar(100) NULL DEFAULT NULL,
            `status_code` smallint(6) NOT NULL,
            `duration_ms` int(11) NOT NULL DEFAULT 0,
            `ip` varchar(64) NULL DEFAULT NULL,
            `error_message` varchar(500) NULL DEFAULT NULL,
            `created_at` datetime NOT NULL,
            PRIMARY KEY (`id`),
            KEY `token_id` (`token_id`),
            KEY `created_at` (`created_at`)
        ) ENGINE=InnoDB DEFAULT CHARSET=" . $charset . ';');
    }

    if (!$CI->db->table_exists($p . 'api_gateway_webhooks')) {
        $CI->db->query('CREATE TABLE `' . $p . "api_gateway_webhooks` (
            `id` int(11) NOT NULL AUTO_INCREMENT,
            `name` varchar(191) NOT NULL,
            `event_pattern` varchar(191) NOT NULL COMMENT 'مثل eta_production.* یا warranty.claim_approved یا * برای همه',
            `endpoint_url` varchar(500) NOT NULL,
            `secret` varchar(191) NULL DEFAULT NULL COMMENT 'برای امضای HMAC-SHA256 بدنه‌ی درخواست',
            `status` enum('active','inactive') NOT NULL DEFAULT 'active',
            `created_by` int(11) NULL DEFAULT NULL,
            `created_at` datetime NOT NULL,
            PRIMARY KEY (`id`)
        ) ENGINE=InnoDB DEFAULT CHARSET=" . $charset . ';');
    }

    update_option('api_gateway_schema_version', API_GATEWAY_SCHEMA_VERSION);
}

register_deactivation_hook(API_GATEWAY_MODULE_NAME, 'api_gateway_deactivation_hook');
function api_gateway_deactivation_hook()
{
    // جدول‌ها و لاگ‌ها عمداً حذف نمی‌شوند - این ماژول بخشی از زیرساخت امنیتی است،
    // غیرفعال‌شدن تصادفی نباید تاریخچه‌ی توکن‌ها/لاگ دسترسی را از بین ببرد.
}

/* ------------------------------------------------------------------ */
/* self-heal schema برای نصب با آپلود مستقیم فایل                     */
/* ------------------------------------------------------------------ */
hooks()->add_action('admin_init', 'api_gateway_maybe_upgrade_schema');
function api_gateway_maybe_upgrade_schema()
{
    $installed = (int) get_option('api_gateway_schema_version');
    if ($installed >= API_GATEWAY_SCHEMA_VERSION) {
        return;
    }

    // Circuit breaker: طبق تجربه‌ی واقعی eta_production - این تابع روی admin_init
    // قلاب شده، پس بدون این محافظ، اگر یک قدم مدام fail کند، کل تابع روی هر
    // بارگذاری هر صفحه‌ی ادمین در کل CRM دوباره اجرا می‌شود.
    $retry_after = get_option('api_gateway_schema_retry_after');
    if ($retry_after && strtotime($retry_after) > time()) {
        return;
    }

    try {
        api_gateway_activation_hook();
        delete_option('api_gateway_schema_retry_after');
    } catch (Throwable $e) {
        update_option('api_gateway_schema_retry_after', date('Y-m-d H:i:s', strtotime('+5 minutes')));
        log_activity('API Gateway: schema upgrade failed - ' . $e->getMessage());
    }
}

function api_gateway_installed()
{
    $CI = &get_instance();

    return $CI->db->table_exists(db_prefix() . 'api_gateway_tokens');
}

/* ------------------------------------------------------------------ */
/* دسترسی/منو                                                          */
/* ------------------------------------------------------------------ */
hooks()->add_action('admin_init', 'api_gateway_register_permissions');
function api_gateway_register_permissions()
{
    $config['capabilities'] = [
        'view'            => _l('api_gateway_cap_view'),
        'manage_tokens'   => _l('api_gateway_cap_manage_tokens'),
        'manage_webhooks' => _l('api_gateway_cap_manage_webhooks'),
    ];
    register_staff_capabilities('api-gateway', $config, _l('api_gateway_menu_name'));
}

hooks()->add_action('admin_init', 'api_gateway_init_menu_items');
function api_gateway_init_menu_items()
{
    if (!staff_can('view', 'api-gateway')) {
        return;
    }
    $CI = &get_instance();
    $CI->app_menu->add_sidebar_menu_item('api_gateway', [
        'name'     => _l('api_gateway_menu_name'),
        'href'     => admin_url('api_gateway'),
        'icon'     => 'fa fa-plug',
        'position' => 61,
    ]);
    $CI->app_menu->add_sidebar_children_item('api_gateway', [
        'slug'   => 'api_gateway_tokens',
        'name'   => _l('api_gateway_menu_tokens'),
        'href'   => admin_url('api_gateway/tokens'),
        'position' => 5,
    ]);
    $CI->app_menu->add_sidebar_children_item('api_gateway', [
        'slug'   => 'api_gateway_endpoints',
        'name'   => _l('api_gateway_menu_endpoints'),
        'href'   => admin_url('api_gateway/endpoints'),
        'position' => 10,
    ]);
    $CI->app_menu->add_sidebar_children_item('api_gateway', [
        'slug'   => 'api_gateway_logs',
        'name'   => _l('api_gateway_menu_logs'),
        'href'   => admin_url('api_gateway/logs'),
        'position' => 15,
    ]);
    $CI->app_menu->add_sidebar_children_item('api_gateway', [
        'slug'   => 'api_gateway_webhooks',
        'name'   => _l('api_gateway_menu_webhooks'),
        'href'   => admin_url('api_gateway/webhooks'),
        'position' => 20,
    ]);
}

/* ------------------------------------------------------------------ */
/* Endpoint registry: نقطه‌ی مرکزی که همه‌ی ماژول‌ها (و خودِ هسته) در آن   */
/* ثبت می‌شوند - طبق قرارداد مستندشده در docs/MODULE_STANDARD.md بخش ۴.   */
/* ------------------------------------------------------------------ */
if (!function_exists('api_gateway_get_endpoints')) {
    function api_gateway_get_endpoints()
    {
        static $endpoints = null;
        if ($endpoints === null) {
            $endpoints = hooks()->apply_filters('api_gateway_register_endpoints', []);
        }

        return $endpoints;
    }
}

/*
 * پوشش هسته‌ی خودِ این ماژول: مشتری، سرنخ، فاکتور، تسک - همان چهار موجودیتی
 * که کانکتور MCP (exir-mcp-server) از قبل از طریق API بومی پرفکس پوشش
 * می‌داد، این‌جا دوباره تحت همان registry واحد ثبت می‌شوند تا کانکتور بتواند
 * فقط با یک base URL/token به همه چیز (هسته + هر ماژول دیگر) دسترسی داشته
 * باشد، به‌جای دو مسیر اتصال جدا.
 */
hooks()->add_filter('api_gateway_register_endpoints', 'api_gateway_register_core_endpoints');
function api_gateway_register_core_endpoints($endpoints)
{
    $endpoints['core'] = [
        [
            'method' => 'GET', 'path' => 'core/customers/search/{term}',
            'handler' => 'Api_gateway_core_model@search_customers', 'permission' => 'core',
            'description' => 'جستجوی مشتری بر اساس نام/شرکت/ایمیل',
        ],
        [
            'method' => 'GET', 'path' => 'core/customers/{id}',
            'handler' => 'Api_gateway_core_model@get_customer', 'permission' => 'core',
            'description' => 'جزئیات یک مشتری',
        ],
        [
            'method' => 'GET', 'path' => 'core/leads/search/{term}',
            'handler' => 'Api_gateway_core_model@search_leads', 'permission' => 'core',
            'description' => 'جستجوی سرنخ بر اساس نام/شرکت',
        ],
        [
            'method' => 'GET', 'path' => 'core/leads/{id}',
            'handler' => 'Api_gateway_core_model@get_lead', 'permission' => 'core',
            'description' => 'جزئیات یک سرنخ',
        ],
        [
            'method' => 'GET', 'path' => 'core/invoices/search/{term}',
            'handler' => 'Api_gateway_core_model@search_invoices', 'permission' => 'core',
            'description' => 'جستجوی فاکتور بر اساس شماره/نام مشتری',
        ],
        [
            'method' => 'GET', 'path' => 'core/invoices/{id}',
            'handler' => 'Api_gateway_core_model@get_invoice', 'permission' => 'core',
            'description' => 'جزئیات یک فاکتور به همراه ردیف‌ها',
        ],
        [
            'method' => 'POST', 'path' => 'core/invoices',
            'handler' => 'Api_gateway_core_model@create_invoice', 'permission' => 'core',
            'params' => [
                'customer_id' => ['type' => 'int', 'required' => true],
                'due_date'    => ['type' => 'date', 'required' => false],
                'items'       => ['type' => 'array', 'required' => true],
            ],
            'description' => 'ایجاد فاکتور جدید برای مشتری',
        ],
        [
            'method' => 'GET', 'path' => 'core/tasks/{id}',
            'handler' => 'Api_gateway_core_model@get_task', 'permission' => 'core',
            'description' => 'جزئیات یک تسک',
        ],
        [
            'method' => 'POST', 'path' => 'core/tasks',
            'handler' => 'Api_gateway_core_model@create_task', 'permission' => 'core',
            'params' => [
                'name'        => ['type' => 'string', 'required' => true],
                'description' => ['type' => 'string', 'required' => false],
                'due_date'    => ['type' => 'date', 'required' => false],
                'rel_id'      => ['type' => 'int', 'required' => false],
                'rel_type'    => ['type' => 'string', 'required' => false],
            ],
            'description' => 'ایجاد تسک جدید، اختیاری وصل به یک مشتری/سرنخ (rel_id+rel_type)',
        ],
    ];

    return $endpoints;
}

/* ------------------------------------------------------------------ */
/* رویدادهای خروجی (outbound webhooks) — طبق قرارداد بخش ۴              */
/* هر ماژولی که hooks()->do_action('module_name.event_name', $data) را  */
/* صدا بزند، اینجا خودکار به همه‌ی webhookهای فعال با event_pattern      */
/* منطبق ارسال می‌شود. هر ماژول کاری برای این بخش نمی‌کند به‌جز صداکردن   */
/* do_action با نام رویداد استاندارد.                                    */
/* ------------------------------------------------------------------ */
if (!function_exists('api_gateway_dispatch_event')) {
    function api_gateway_dispatch_event($event, $payload)
    {
        $CI = &get_instance();
        if (!$CI->db->table_exists(db_prefix() . 'api_gateway_webhooks')) {
            return;
        }

        $webhooks = $CI->db->where('status', 'active')->get(db_prefix() . 'api_gateway_webhooks')->result_array();
        foreach ($webhooks as $hook) {
            if (!api_gateway_event_matches($hook['event_pattern'], $event)) {
                continue;
            }
            api_gateway_send_webhook($hook, $event, $payload);
        }
    }
}

if (!function_exists('api_gateway_event_matches')) {
    /**
     * الگوی رویداد یا دقیقاً برابر است، یا با * تمام می‌شود (پیشوند + همه‌چیز
     * بعدش، مثل eta_production.* برای هر رویداد این ماژول)، یا خودِ * یعنی همه.
     */
    function api_gateway_event_matches($pattern, $event)
    {
        if ($pattern === '*') {
            return true;
        }
        if ($pattern === $event) {
            return true;
        }
        if (substr($pattern, -2) === '.*') {
            $prefix = substr($pattern, 0, -1); // شامل نقطه
            return strncmp($event, $prefix, strlen($prefix)) === 0;
        }

        return false;
    }
}

if (!function_exists('api_gateway_send_webhook')) {
    function api_gateway_send_webhook($hook, $event, $payload)
    {
        $body = json_encode(['event' => $event, 'data' => $payload, 'sent_at' => date('c')], JSON_UNESCAPED_UNICODE);
        $signature = !empty($hook['secret']) ? hash_hmac('sha256', $body, $hook['secret']) : '';

        try {
            $ch = curl_init($hook['endpoint_url']);
            curl_setopt_array($ch, [
                CURLOPT_POST           => true,
                CURLOPT_POSTFIELDS     => $body,
                CURLOPT_HTTPHEADER     => [
                    'Content-Type: application/json',
                    'X-Api-Gateway-Signature: ' . $signature,
                    'X-Api-Gateway-Event: ' . $event,
                ],
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT        => 8,
                CURLOPT_CONNECTTIMEOUT => 4,
            ]);
            curl_exec($ch);
            curl_close($ch);
        } catch (Throwable $e) {
            log_activity('API Gateway: webhook dispatch failed [Event:' . $event . ', Webhook:' . $hook['id'] . '] - ' . $e->getMessage());
        }
    }
}

/*
 * هر ماژولی که از قبل رویداد استاندارد `module_name.event_name` منتشر
 * می‌کند (طبق قرارداد بخش ۴) خودکار پوشش داده می‌شود - نیازی به لیست‌کردن
 * دستی هر رویداد نیست، چون این هوک‌ها مستقیماً به همان اکشن‌ها گوش می‌دهند.
 * دو نمونه‌ی واقعی که از قبل در پروژه صدا زده می‌شوند (این نشست ساخته شدند):
 */
hooks()->add_action('exir_accounting.document_confirmed', function ($data) {
    api_gateway_dispatch_event('exir_accounting.document_confirmed', $data);
});
hooks()->add_action('exir_accounting.payment_recorded', function ($data) {
    api_gateway_dispatch_event('exir_accounting.payment_recorded', $data);
});
