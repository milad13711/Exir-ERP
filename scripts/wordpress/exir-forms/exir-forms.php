<?php
/**
 * Plugin Name: Exir Forms (فرم‌ساز اکسیر)
 * Description: Embed forms built in Exir ERP anywhere in WordPress with the [exir_form] shortcode. شورت‌کد [exir_form] برای نمایش فرم‌های فرم‌ساز اکسیر.
 * Version: 1.0.0
 * Requires at least: 5.0
 * Requires PHP: 7.2
 * License: GPLv2 or later
 * Text Domain: exir-forms
 */

if (!defined('ABSPATH')) {
    exit;
}

define('EXIR_FORMS_VERSION', '1.0.0');
define('EXIR_FORMS_OPTION_HOST', 'exir_forms_host');

/** فقط origin (scheme://host[:port]) از یک آدرس؛ در صورت نامعتبر بودن رشته‌ی خالی. */
function exir_forms_origin($url)
{
    $url = esc_url_raw(trim((string) $url), array('http', 'https'));
    if (!$url) {
        return '';
    }
    $p = wp_parse_url($url);
    if (empty($p['scheme']) || empty($p['host'])) {
        return '';
    }
    return $p['scheme'] . '://' . $p['host'] . (!empty($p['port']) ? ':' . $p['port'] : '');
}

/**
 * [exir_form url="https://panel.example.com/f/t1a2b3c4d5e/my-form"]
 * [exir_form id="t1a2b3c4d5e/my-form"]   (نیاز به تنظیم آدرس پنل در تنظیمات ← Exir Forms)
 * گزینه‌ها: theme=light|dark|auto  lang=fa|en  primary=#4338ca  redirect=https://…  success_message="…"  min_height=320  hide_title=1
 */
function exir_forms_shortcode($atts)
{
    $a = shortcode_atts(array(
        'url' => '',
        'id' => '',
        'host' => '',
        'theme' => '',
        'lang' => '',
        'primary' => '',
        'redirect' => '',
        'success_message' => '',
        'min_height' => '',
        'hide_title' => '',
    ), $atts, 'exir_form');

    $ref = '';
    $host = '';
    if ($a['url'] !== '') {
        $host = exir_forms_origin($a['url']);
        $ref = esc_url_raw($a['url'], array('http', 'https'));
    } elseif (preg_match('#^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+$#', $a['id'])) {
        $host = exir_forms_origin($a['host'] !== '' ? $a['host'] : get_option(EXIR_FORMS_OPTION_HOST, ''));
        $ref = $a['id'];
    }

    if ($ref === '' || $host === '') {
        return current_user_can('edit_posts')
            ? '<p style="color:#b91c1c">Exir Forms: [exir_form url="…"] یا id + آدرس پنل را تنظیم کنید.</p>'
            : '';
    }

    $attrs = array('data-exir-form' => $ref, 'data-host' => $host);
    if (in_array($a['theme'], array('light', 'dark', 'auto'), true)) {
        $attrs['data-theme'] = $a['theme'];
    }
    if (in_array($a['lang'], array('fa', 'en'), true)) {
        $attrs['data-lang'] = $a['lang'];
    }
    if (preg_match('/^#?[0-9a-fA-F]{3,8}$/', $a['primary'])) {
        $attrs['data-primary'] = '#' . ltrim($a['primary'], '#');
    }
    if ($a['redirect'] !== '' && esc_url_raw($a['redirect'], array('http', 'https'))) {
        $attrs['data-redirect'] = esc_url_raw($a['redirect'], array('http', 'https'));
    }
    if ($a['success_message'] !== '') {
        $attrs['data-success-message'] = sanitize_text_field($a['success_message']);
    }
    if (ctype_digit((string) $a['min_height'])) {
        $attrs['data-min-height'] = $a['min_height'];
    }
    if ($a['hide_title'] !== '') {
        $attrs['data-hide-title'] = '1';
    }

    $html = '<div';
    foreach ($attrs as $k => $v) {
        $html .= ' ' . esc_attr($k) . '="' . esc_attr($v) . '"';
    }
    $html .= '></div>';

    // اسکریپت جاسازی فقط یک بار در صفحه
    static $script_printed = array();
    if (empty($script_printed[$host])) {
        $script_printed[$host] = true;
        $html .= '<script async src="' . esc_url($host . '/embed/exir-forms.js') . '"></script>';
    }
    return $html;
}
add_shortcode('exir_form', 'exir_forms_shortcode');

/* ── صفحه‌ی تنظیمات: آدرس پنل (فقط برای shortcode با id) ─────────────────── */
function exir_forms_register_settings()
{
    register_setting('exir_forms', EXIR_FORMS_OPTION_HOST, array(
        'type' => 'string',
        'sanitize_callback' => 'exir_forms_origin',
        'default' => '',
    ));
}
add_action('admin_init', 'exir_forms_register_settings');

function exir_forms_menu()
{
    add_options_page('Exir Forms', 'Exir Forms', 'manage_options', 'exir-forms', 'exir_forms_settings_page');
}
add_action('admin_menu', 'exir_forms_menu');

function exir_forms_settings_page()
{
    if (!current_user_can('manage_options')) {
        return;
    }
    ?>
    <div class="wrap" dir="rtl">
        <h1>Exir Forms — فرم‌ساز اکسیر</h1>
        <form method="post" action="options.php">
            <?php settings_fields('exir_forms'); ?>
            <table class="form-table">
                <tr>
                    <th scope="row"><label for="exir_forms_host">آدرس پنل اکسیر</label></th>
                    <td>
                        <input type="url" id="exir_forms_host" name="<?php echo esc_attr(EXIR_FORMS_OPTION_HOST); ?>"
                               value="<?php echo esc_attr(get_option(EXIR_FORMS_OPTION_HOST, '')); ?>"
                               class="regular-text" dir="ltr" placeholder="https://panel.example.com">
                        <p class="description">فقط برای شورت‌کد <code>[exir_form id="کلید/اسلاگ"]</code> لازم است. با <code>url="…"</code> نیازی به این تنظیم نیست.</p>
                    </td>
                </tr>
            </table>
            <?php submit_button(); ?>
        </form>
        <h2>نمونه</h2>
        <p><code dir="ltr">[exir_form url="https://panel.example.com/f/t1a2b3c4d5e/my-form" theme="auto"]</code></p>
    </div>
    <?php
}
