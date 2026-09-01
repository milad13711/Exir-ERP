<?php

defined('BASEPATH') or exit('No direct script access allowed');

/**
 * Handler دسترسی به موجودیت‌های هسته‌ی پرفکس (مشتری/سرنخ/فاکتور/تسک) برای
 * API Gateway. جستجو مستقیم روی جدول‌های هسته می‌خواند (فقط خواندنی، همان
 * الگویی که exir_accounting_documents_model::get_core_sales_invoices() هم
 * استفاده می‌کند)؛ هر عملیات نوشتنی همیشه از مدل واقعی هسته عبور می‌کند
 * (Clients_model/Leads_model/Invoices_model/Tasks_model) تا شماره‌گذاری،
 * محاسبه‌ی مالیات/جمع، و هوک‌های هسته دست‌نخورده بمانند.
 */
class Api_gateway_core_model extends App_Model
{
    /**
     * توکن‌های API Gateway هیچ سشن کارمندی ندارند، اما بعضی مدل‌های هسته
     * (مثل Tasks_model::add()) داخلشان مستقیم get_staff_user_id() را صدا
     * می‌زنند - بدون شبیه‌سازی موقت سشن، آن مقدار همیشه false/0 می‌شود و
     * تسک ساخته‌شده هیچ صاحبی ندارد. این تابع فقط برای طول اجرای $fn
     * سشن کارمندِ acting_staff_id توکن را شبیه‌سازی می‌کند، بعد دقیقاً به
     * حالت قبل (چه سشن واقعی وجود داشت چه نداشت) برمی‌گرداند.
     */
    protected function run_as_staff($staff_id, callable $fn)
    {
        if (empty($staff_id)) {
            return $fn();
        }

        $CI = &get_instance();
        $had_session = $CI->session->has_userdata('staff_logged_in');
        $previous_staff_id = $CI->session->userdata('staff_user_id');

        $CI->session->set_userdata(['staff_logged_in' => true, 'staff_user_id' => (int) $staff_id]);

        try {
            return $fn();
        } finally {
            if ($had_session) {
                $CI->session->set_userdata(['staff_logged_in' => true, 'staff_user_id' => $previous_staff_id]);
            } else {
                $CI->session->unset_userdata('staff_logged_in');
                $CI->session->unset_userdata('staff_user_id');
            }
        }
    }

    public function search_customers($path_params, $input)
    {
        $term = urldecode($path_params['term'] ?? '');
        $rows = $this->db->select('userid, company, phonenumber, email')
            ->like('company', $term)
            ->or_like('email', $term)
            ->or_like('phonenumber', $term)
            ->limit(20)
            ->get(db_prefix() . 'clients')->result_array();

        return $rows;
    }

    public function get_customer($path_params, $input)
    {
        $CI = &get_instance();
        $CI->load->model('clients_model');
        $client = $CI->clients_model->get((int) $path_params['id']);
        if (!$client) {
            throw new RuntimeException('customer_not_found');
        }

        return (array) $client;
    }

    public function search_leads($path_params, $input)
    {
        $term = urldecode($path_params['term'] ?? '');
        $rows = $this->db->select('id, name, company, email, phonenumber, status')
            ->like('name', $term)
            ->or_like('company', $term)
            ->limit(20)
            ->get(db_prefix() . 'leads')->result_array();

        return $rows;
    }

    public function get_lead($path_params, $input)
    {
        $CI = &get_instance();
        $CI->load->model('leads_model');
        $lead = $CI->leads_model->get((int) $path_params['id']);
        if (!$lead) {
            throw new RuntimeException('lead_not_found');
        }

        return (array) $lead;
    }

    public function search_invoices($path_params, $input)
    {
        $term = urldecode($path_params['term'] ?? '');
        $rows = $this->db->select(db_prefix() . 'invoices.id, ' . db_prefix() . 'invoices.total, ' . db_prefix() . 'invoices.status, ' . db_prefix() . 'invoices.duedate, ' . db_prefix() . 'clients.company as customer_name')
            ->from(db_prefix() . 'invoices')
            ->join(db_prefix() . 'clients', db_prefix() . 'clients.userid = ' . db_prefix() . 'invoices.clientid', 'left')
            ->group_start()
                ->like(db_prefix() . 'clients.company', $term)
                ->or_like(db_prefix() . 'invoices.id', $term)
            ->group_end()
            ->limit(20)
            ->get()->result_array();

        return $rows;
    }

    public function get_invoice($path_params, $input)
    {
        $CI = &get_instance();
        $CI->load->model('invoices_model');
        $invoice = $CI->invoices_model->get((int) $path_params['id']);
        if (!$invoice) {
            throw new RuntimeException('invoice_not_found');
        }
        $invoice = (array) $invoice;
        $invoice['items'] = get_items_by_type('invoice', $path_params['id']);

        return $invoice;
    }

    public function create_invoice($path_params, $input, $context = [])
    {
        if (empty($input['customer_id']) || empty($input['items'])) {
            throw new InvalidArgumentException('customer_id_and_items_required');
        }

        $CI = &get_instance();
        $CI->load->model('invoices_model');

        $newitems = [];
        $i = 1;
        foreach ($input['items'] as $item) {
            $newitems[$i] = [
                'description' => $item['description'] ?? '',
                'long_description' => '',
                'qty'  => $item['qty'] ?? 1,
                'unit' => '',
                'rate' => $item['rate'] ?? 0,
                'order' => $i,
            ];
            $i++;
        }

        $invoice_id = $CI->invoices_model->add([
            'clientid'   => (int) $input['customer_id'],
            'date'       => date('Y-m-d'),
            'duedate'    => null, // پایین‌تر با UPDATE مستقیم و صریح تنظیم می‌شود - نکته‌ی امنیتی زیر را ببین
            'number'     => null,
            'sale_agent' => (int) ($context['acting_staff_id'] ?? 0),
            'newitems'   => $newitems,
        ]);

        if (!$invoice_id) {
            throw new RuntimeException('core_invoice_create_failed');
        }

        /*
         * لایه‌ی محافظتی حیاتی: to_sql_date() سفارشی این نصب هر رشته‌ی
         * چهاررقم-دورقم-دورقم را بدون بررسی بازه‌ی سال شمسی فرض می‌کند و
         * اشتباهی «تبدیل» می‌کند - همان باگ که در exir_accounting کشف و
         * گزارش شد (تسک جدا برای رفع ریشه‌ای ثبت شده). تا وقتی آن تسک
         * انجام نشده، هر تاریخ Y-m-d واقعی که وارد یک متد هسته می‌شود باید
         * بعد از insert با UPDATE مستقیم روی مقدار درست بازنویسی شود.
         */
        if (!empty($input['due_date'])) {
            try {
                $CI->db->where('id', $invoice_id)->update(db_prefix() . 'invoices', [
                    'duedate' => $input['due_date'],
                ]);
            } catch (Throwable $e) {
                log_activity('API Gateway: could not enforce exact due date on invoice #' . $invoice_id . ' - ' . $e->getMessage());
            }
        }

        return ['invoice_id' => $invoice_id];
    }

    public function get_task($path_params, $input)
    {
        $CI = &get_instance();
        $CI->load->model('tasks_model');
        $task = $CI->tasks_model->get((int) $path_params['id']);
        if (!$task) {
            throw new RuntimeException('task_not_found');
        }

        return (array) $task;
    }

    public function create_task($path_params, $input, $context = [])
    {
        if (empty($input['name'])) {
            throw new InvalidArgumentException('name_required');
        }

        $CI = &get_instance();
        $CI->load->model('tasks_model');

        $data = [
            'name'        => $input['name'],
            'description' => $input['description'] ?? '',
            'startdate'   => date('Y-m-d'), // میلادی امن (امروز) - از هر تاریخ ورودی خام پرهیز می‌کنیم، طبق یادداشت باگ to_sql_date() بالا
        ];
        if (!empty($input['rel_id']) && !empty($input['rel_type'])) {
            $data['rel_id']   = (int) $input['rel_id'];
            $data['rel_type'] = $input['rel_type'];
        }

        // Tasks_model::add() داخلش مستقیم get_staff_user_id() را برای addedfrom
        // صدا می‌زند - بدون شبیه‌سازی موقت سشن، تسک بدون صاحب می‌ماند.
        $task_id = $this->run_as_staff($context['acting_staff_id'] ?? null, function () use ($CI, $data) {
            return $CI->tasks_model->add($data);
        });
        if (!$task_id) {
            throw new RuntimeException('core_task_create_failed');
        }

        // همان لایه‌ی محافظتی: سررسید واقعی را بعد از insert با مقدار Y-m-d درستِ خودمان جایگزین کن
        if (!empty($input['due_date'])) {
            try {
                $CI->db->where('id', $task_id)->update(db_prefix() . 'tasks', [
                    'duedate' => $input['due_date'],
                ]);
            } catch (Throwable $e) {
                log_activity('API Gateway: could not enforce exact due date on task #' . $task_id . ' - ' . $e->getMessage());
            }
        }

        return ['task_id' => $task_id];
    }
}
