<?php

defined('BASEPATH') or exit('No direct script access allowed');

class Api_gateway extends AdminController
{
    public function __construct()
    {
        parent::__construct();
        if (!staff_can('view', 'api-gateway')) {
            access_denied('api_gateway');
        }
    }

    public function index()
    {
        $data['title'] = _l('api_gateway_menu_name');
        $data['tokens_count'] = $this->db->where('status', 'active')->count_all_results(db_prefix() . 'api_gateway_tokens');
        $data['endpoints'] = api_gateway_get_endpoints();
        $data['endpoints_count'] = array_sum(array_map('count', $data['endpoints']));
        $data['requests_today'] = $this->db->where('created_at >=', date('Y-m-d 00:00:00'))
            ->count_all_results(db_prefix() . 'api_gateway_logs');
        $data['recent_logs'] = $this->db->order_by('id', 'desc')->limit(10)
            ->get(db_prefix() . 'api_gateway_logs')->result_array();

        $this->load->view('admin/index', $data);
    }

    public function tokens()
    {
        if (!staff_can('manage_tokens', 'api-gateway')) {
            access_denied('api_gateway');
        }

        if ($this->input->post()) {
            $name = trim($this->input->post('name'));
            $scopes = $this->input->post('scopes') === 'all' ? '*' : implode(',', (array) $this->input->post('module_scopes'));

            if ($name && $scopes) {
                $token = bin2hex(random_bytes(32)); // فقط همین یک‌بار در حافظه؛ در دیتابیس فقط هش آن ذخیره می‌شود
                $this->db->insert(db_prefix() . 'api_gateway_tokens', [
                    'name'            => $name,
                    'token_hash'      => hash('sha256', $token),
                    'token_preview'   => substr($token, -4),
                    'scopes'          => $scopes,
                    'acting_staff_id' => $this->input->post('acting_staff_id') ?: null,
                    'status'          => 'active',
                    'created_by'    => get_staff_user_id(),
                    'created_at'    => date('Y-m-d H:i:s'),
                ]);
                set_alert('success', _l('api_gateway_token_created'));
                // توکن واقعی فقط یک‌بار، در پیام موفقیت نشان داده می‌شود - بعد از این
                // ریدایرکت هرگز دوباره قابل بازیابی نیست (فقط ۴ کاراکتر آخر در لیست می‌ماند).
                $this->session->set_flashdata('api_gateway_new_token', $token);
            }
            redirect(admin_url('api_gateway/tokens'));
        }

        $data['title'] = _l('api_gateway_menu_tokens');
        $data['tokens'] = $this->db->order_by('id', 'desc')->get(db_prefix() . 'api_gateway_tokens')->result_array();
        $data['available_modules'] = array_keys(api_gateway_get_endpoints());
        $data['new_token'] = $this->session->flashdata('api_gateway_new_token');
        $data['staff_list'] = $this->db->select('staffid, firstname, lastname')->where('active', 1)
            ->order_by('firstname', 'asc')->get(db_prefix() . 'staff')->result_array();

        $this->load->view('admin/tokens', $data);
    }

    public function token_revoke($id)
    {
        if (!staff_can('manage_tokens', 'api-gateway')) {
            access_denied('api_gateway');
        }
        $this->db->where('id', $id)->update(db_prefix() . 'api_gateway_tokens', [
            'status'     => 'revoked',
            'revoked_at' => date('Y-m-d H:i:s'),
        ]);
        set_alert('success', _l('api_gateway_token_revoked'));
        redirect(admin_url('api_gateway/tokens'));
    }

    public function token_delete($id)
    {
        if (!staff_can('manage_tokens', 'api-gateway')) {
            access_denied('api_gateway');
        }
        $this->db->where('id', $id)->delete(db_prefix() . 'api_gateway_tokens');
        set_alert('success', _l('deleted', ''));
        redirect(admin_url('api_gateway/tokens'));
    }

    /**
     * مستندسازی خودکار API - مستقیم از همان registry که هر ماژول در فایل
     * bootstrap خودش پر می‌کند، پس همیشه با endpointهای واقعاً فعال یکی است.
     */
    public function endpoints()
    {
        $data['title'] = _l('api_gateway_menu_endpoints');
        $data['endpoints'] = api_gateway_get_endpoints();
        $data['base_url'] = rtrim(site_url('api_gateway/dispatch/v1'), '/');

        $this->load->view('admin/endpoints', $data);
    }

    public function logs()
    {
        $page = (int) ($this->input->get('page') ?: 1);
        $per_page = 50;

        $data['title'] = _l('api_gateway_menu_logs');
        $data['logs'] = $this->db->order_by('id', 'desc')->limit($per_page, ($page - 1) * $per_page)
            ->get(db_prefix() . 'api_gateway_logs')->result_array();
        $data['total'] = $this->db->count_all(db_prefix() . 'api_gateway_logs');
        $data['page'] = $page;
        $data['per_page'] = $per_page;
        $data['tokens'] = $this->db->select('id, name')->get(db_prefix() . 'api_gateway_tokens')->result_array();

        $this->load->view('admin/logs', $data);
    }

    public function webhooks()
    {
        if (!staff_can('manage_webhooks', 'api-gateway')) {
            access_denied('api_gateway');
        }

        if ($this->input->post()) {
            $this->db->insert(db_prefix() . 'api_gateway_webhooks', [
                'name'          => $this->input->post('name'),
                'event_pattern' => $this->input->post('event_pattern'),
                'endpoint_url'  => $this->input->post('endpoint_url'),
                'secret'        => $this->input->post('secret'),
                'status'        => 'active',
                'created_by'    => get_staff_user_id(),
                'created_at'    => date('Y-m-d H:i:s'),
            ]);
            set_alert('success', _l('added_successfully', ''));
            redirect(admin_url('api_gateway/webhooks'));
        }

        $data['title'] = _l('api_gateway_menu_webhooks');
        $data['webhooks'] = $this->db->order_by('id', 'desc')->get(db_prefix() . 'api_gateway_webhooks')->result_array();

        $this->load->view('admin/webhooks', $data);
    }

    public function webhook_toggle($id)
    {
        if (!staff_can('manage_webhooks', 'api-gateway')) {
            access_denied('api_gateway');
        }
        $current = $this->db->where('id', $id)->get(db_prefix() . 'api_gateway_webhooks')->row_array();
        if ($current) {
            $this->db->where('id', $id)->update(db_prefix() . 'api_gateway_webhooks', [
                'status' => $current['status'] === 'active' ? 'inactive' : 'active',
            ]);
        }
        redirect(admin_url('api_gateway/webhooks'));
    }

    public function webhook_delete($id)
    {
        if (!staff_can('manage_webhooks', 'api-gateway')) {
            access_denied('api_gateway');
        }
        $this->db->where('id', $id)->delete(db_prefix() . 'api_gateway_webhooks');
        set_alert('success', _l('deleted', ''));
        redirect(admin_url('api_gateway/webhooks'));
    }
}
