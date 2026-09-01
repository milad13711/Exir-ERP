<?php

defined('BASEPATH') or exit('No direct script access allowed');

/**
 * نقطه‌ی ورود عمومی API Gateway - بدون سشن ادمین، فقط با توکن Bearer.
 * آدرس هر endpoint: https://<crm-domain>/api_gateway/dispatch/v1/<path-ثبت‌شده>
 * مثال واقعی: GET /api_gateway/dispatch/v1/core/customers/search/آریا
 *
 * این کنترلر عمداً CI_Controller خام است (نه AdminController) - دقیقاً همان
 * الگویی که در exir_accounting/controllers/Api.php برای اتصال بیرونی
 * استفاده شده - چون باید بدون سشن مرورگر قابل صدا زدن باشد.
 */
class Dispatch extends CI_Controller
{
    protected $token_row = null;

    protected function json($data, $code = 200)
    {
        http_response_code($code);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($data, JSON_UNESCAPED_UNICODE);
        exit;
    }

    /**
     * احراز هویت: هدر Authorization: Bearer <token>. توکن هرگز در دیتابیس
     * plain ذخیره نشده (فقط sha256 آن) - پس همیشه هش ورودی با ستون
     * token_hash مقایسه می‌شود، هرگز خودِ توکن مستقیم.
     */
    protected function authenticate()
    {
        $header = $this->input->get_request_header('Authorization');
        if (!$header || stripos($header, 'Bearer ') !== 0) {
            $this->fail(401, 'missing_or_invalid_authorization_header');
        }
        $token = trim(substr($header, 7));
        if ($token === '') {
            $this->fail(401, 'missing_token');
        }

        $hash = hash('sha256', $token);
        $row = $this->db->where('token_hash', $hash)->where('status', 'active')
            ->get(db_prefix() . 'api_gateway_tokens')->row_array();

        if (!$row) {
            $this->fail(401, 'invalid_or_revoked_token');
        }

        $this->db->where('id', $row['id'])->update(db_prefix() . 'api_gateway_tokens', [
            'last_used_at' => date('Y-m-d H:i:s'),
            'last_used_ip' => $this->input->ip_address(),
        ]);

        $this->token_row = $row;
    }

    protected function scope_allows($token_row, $module_name)
    {
        $scopes = array_map('trim', explode(',', (string) $token_row['scopes']));

        return in_array('*', $scopes, true) || in_array($module_name, $scopes, true);
    }

    protected function fail($code, $message)
    {
        $this->log_request($code, null, $message);
        $this->json(['success' => false, 'error' => $message], $code);
    }

    protected function log_request($status_code, $module_name = null, $error_message = null)
    {
        $started_at = defined('API_GATEWAY_REQUEST_START') ? API_GATEWAY_REQUEST_START : microtime(true);
        $this->db->insert(db_prefix() . 'api_gateway_logs', [
            'token_id'      => $this->token_row['id'] ?? null,
            'method'        => $this->input->method(true),
            'path'          => uri_string(),
            'module_name'   => $module_name,
            'status_code'   => $status_code,
            'duration_ms'   => (int) round((microtime(true) - $started_at) * 1000),
            'ip'            => $this->input->ip_address(),
            'error_message' => $error_message ? mb_substr($error_message, 0, 500) : null,
            'created_at'    => date('Y-m-d H:i:s'),
        ]);
    }

    /**
     * تمام مسیرهای v1 از این‌جا رد می‌شوند. طبق روتینگ پیش‌فرض MX،
     * `api_gateway/dispatch/v1/core/customers/123` یعنی متد v1 با
     * آرگومان‌های ('core','customers','123') صدا زده می‌شود.
     */
    public function v1()
    {
        if (!defined('API_GATEWAY_REQUEST_START')) {
            define('API_GATEWAY_REQUEST_START', microtime(true));
        }

        $this->authenticate();

        $segments = func_get_args();
        $path = implode('/', $segments);
        $method = $this->input->method(true);

        $endpoints = api_gateway_get_endpoints();
        $match = $this->find_matching_endpoint($endpoints, $method, $path);

        if (!$match) {
            $this->fail(404, 'no_matching_endpoint');

            return;
        }

        [$endpoint, $module_name, $path_params] = $match;

        if (!$this->scope_allows($this->token_row, $module_name)) {
            $this->log_request(403, $module_name, 'scope_not_granted');
            $this->json(['success' => false, 'error' => 'scope_not_granted', 'module' => $module_name], 403);

            return;
        }

        try {
            [$class, $handler_method] = explode('@', $endpoint['handler']);
            $model_key = strtolower($class);
            $this->load->model($module_name . '/' . $model_key);

            if (!isset($this->$class) || !method_exists($this->$class, $handler_method)) {
                throw new RuntimeException('handler_not_found: ' . $endpoint['handler']);
            }

            $input = $method === 'GET' ? $this->input->get() : (json_decode($this->input->raw_input_stream, true) ?: []);
            $context = [
                'acting_staff_id' => $this->token_row['acting_staff_id'] ?? null,
                'token_id'        => $this->token_row['id'],
            ];
            $result = $this->$class->$handler_method($path_params, $input, $context);

            $this->log_request(200, $module_name);
            $this->json(['success' => true, 'data' => $result]);
        } catch (Throwable $e) {
            log_activity('API Gateway: endpoint failed [' . $method . ' ' . $path . '] - ' . $e->getMessage());
            $this->log_request(500, $module_name, $e->getMessage());
            $this->json(['success' => false, 'error' => 'internal_error'], 500);
        }
    }

    /**
     * تطبیق مسیر واقعی درخواست‌شده با الگوی ثبت‌شده - پشتیبانی از پارامترهای
     * `{name}` داخل path (مثل `core/customers/{id}`).
     */
    protected function find_matching_endpoint($endpoints, $method, $path)
    {
        foreach ($endpoints as $module_name => $module_endpoints) {
            foreach ($module_endpoints as $endpoint) {
                if (strtoupper($endpoint['method']) !== $method) {
                    continue;
                }
                // تبدیل قالب مسیر ثبت‌شده (مثل core/customers/{id}) به regex - هر
                // بخش ثابت جداگانه escape می‌شود تا با {param} جایگزین‌شده تداخل نکند.
                $segments_tpl = explode('/', $endpoint['path']);
                $pattern_parts = array_map(function ($segment) {
                    return preg_match('/^\{[a-zA-Z_]+\}$/', $segment) ? '([^/]+)' : preg_quote($segment, '#');
                }, $segments_tpl);
                $pattern = implode('/', $pattern_parts);

                if (preg_match('#^' . $pattern . '$#u', $path, $matches)) {
                    preg_match_all('/\{([a-zA-Z_]+)\}/', $endpoint['path'], $param_names);
                    $path_params = [];
                    foreach ($param_names[1] as $i => $name) {
                        $path_params[$name] = $matches[$i + 1] ?? null;
                    }

                    return [$endpoint, $module_name, $path_params];
                }
            }
        }

        return null;
    }
}
