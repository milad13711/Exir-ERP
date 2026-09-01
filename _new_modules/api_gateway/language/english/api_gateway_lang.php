<?php

defined('BASEPATH') or exit('No direct script access allowed');

$lang['api_gateway_menu_name']      = 'API Gateway';
$lang['api_gateway_menu_tokens']    = 'Tokens';
$lang['api_gateway_menu_endpoints'] = 'API Docs';
$lang['api_gateway_menu_logs']      = 'Request Logs';
$lang['api_gateway_menu_webhooks']  = 'Outbound Webhooks';

$lang['api_gateway_cap_view']            = 'View';
$lang['api_gateway_cap_manage_tokens']   = 'Manage Tokens';
$lang['api_gateway_cap_manage_webhooks'] = 'Manage Webhooks';

$lang['api_gateway_active_tokens']        = 'Active Tokens';
$lang['api_gateway_registered_endpoints'] = 'Registered Endpoints';
$lang['api_gateway_modules']               = 'modules';
$lang['api_gateway_requests_today']       = 'Requests Today';
$lang['api_gateway_recent_requests']      = 'Recent Requests';
$lang['api_gateway_view_all_logs']        = 'View all logs';

$lang['api_gateway_col_time']     = 'Time';
$lang['api_gateway_col_method']   = 'Method';
$lang['api_gateway_col_path']     = 'Path';
$lang['api_gateway_col_module']   = 'Module';
$lang['api_gateway_col_status']   = 'Status';
$lang['api_gateway_col_duration'] = 'Duration';
$lang['api_gateway_col_ip']       = 'IP';
$lang['api_gateway_col_description'] = 'Description';

$lang['api_gateway_new_token']              = 'New Token';
$lang['api_gateway_token_name']             = 'Token Name';
$lang['api_gateway_token_name_placeholder'] = 'e.g. My Personal Agent';
$lang['api_gateway_acting_staff']           = 'Acting Staff';
$lang['api_gateway_acting_staff_none']      = 'No specific staff (system)';
$lang['api_gateway_acting_staff_hint']      = 'Records this token creates (invoices, tasks, ...) are attributed to this staff member, as if they had logged in and created them themselves.';
$lang['api_gateway_token_scope']            = 'Access Scope';
$lang['api_gateway_scope_all']              = 'Access to all modules and core';
$lang['api_gateway_scope_custom']           = 'Selected modules only';
$lang['api_gateway_token_preview']          = 'Token';
$lang['api_gateway_last_used']              = 'Last Used';
$lang['api_gateway_revoke']                 = 'Revoke';
$lang['api_gateway_revoked']                = 'Revoked';
$lang['api_gateway_active']                 = 'Active';
$lang['api_gateway_inactive']               = 'Inactive';
$lang['api_gateway_confirm_revoke']         = 'Revoke this token? Any tool using it will lose access immediately.';
$lang['api_gateway_token_created']          = 'Token created';
$lang['api_gateway_token_revoked']          = 'Token revoked';
$lang['api_gateway_token_show_once_title']  = 'Copy this token now';
$lang['api_gateway_token_show_once_body']   = 'This is your only chance to see the full token - after closing this message only the last 4 characters remain visible in the list (the system itself only stores a one-way hash, not the token itself).';
$lang['api_gateway_copy']                   = 'Copy';

$lang['api_gateway_base_url_hint']  = 'Base URL for every endpoint (to connect a connector/agent, use this URL + the path from the table below + an Authorization: Bearer &lt;token&gt; header):';
$lang['api_gateway_webhook_events'] = 'Related events';

$lang['api_gateway_new_webhook']                = 'New Webhook';
$lang['api_gateway_webhook_name']               = 'Name';
$lang['api_gateway_webhook_event_pattern']      = 'Event Pattern';
$lang['api_gateway_webhook_event_pattern_hint'] = 'Example: module_name.* for every event of one module, module_name.event_name for one specific event, or * for everything.';
$lang['api_gateway_webhook_url']                = 'URL';
$lang['api_gateway_webhook_secret']             = 'Signing Secret (optional)';
$lang['api_gateway_webhook_secret_hint']        = 'If set, every request is signed with an X-Api-Gateway-Signature header (HMAC-SHA256) so the receiving system can verify authenticity.';

// Page help — unified standard (button always first pull-right + modal + worked example)
$lang['api_gateway_help_btn'] = 'Help';

$lang['api_gateway_help_title_index'] = 'API Gateway Help';
$lang['api_gateway_help_body_index'] = '
<ol>
  <li>The API Gateway is a single entry point for connecting external tools (like a personal AI agent through an MCP connector) to Perfex core and every installed module.</li>
  <li>First create an access token on the "Tokens" page, then copy each endpoint\'s exact URL from the "API Docs" page.</li>
  <li>Every request is recorded in "Request Logs" so you can see exactly what a connected tool called if it ever misbehaves.</li>
</ol>
<div class="alert alert-info" style="margin-top:14px;">
  <strong><i class="fa fa-lightbulb-o"></i> Example:</strong>
  You want to connect a personal agent via MCP. Create a token named "My Personal Agent", enter it in the MCP connector settings - the agent can now read/write customers, leads, invoices, and data from other modules.
</div>
';

$lang['api_gateway_help_title_tokens'] = 'Access Tokens Help';
$lang['api_gateway_help_body_tokens'] = '
<ol>
  <li>A token authenticates an external tool instead of a staff password.</li>
  <li>You can restrict a token to specific modules - e.g. one token for "Warehouse" and "Order Management" only, with no access to accounting.</li>
  <li>The full token is shown only once, at creation - afterward only its last 4 characters remain visible for identification; if lost, create a new one.</li>
  <li>"Revoke" disables a token without deleting its log history; "Delete" removes the record entirely.</li>
</ol>
<div class="alert alert-info" style="margin-top:14px;">
  <strong><i class="fa fa-lightbulb-o"></i> Example:</strong>
  You want an external reporting tool to only read invoices, nothing else. Create a token with custom scope limited to the "core" module and hand it to that tool.
</div>
';

$lang['api_gateway_help_title_endpoints'] = 'API Docs Help';
$lang['api_gateway_help_body_endpoints'] = '
<ol>
  <li>This page is generated automatically from what each module actually registered - it can never drift out of sync with the real code.</li>
  <li>Each row is one callable operation: HTTP method (GET to read, POST to create, ...), full URL, and a short description.</li>
</ol>
<div class="alert alert-info" style="margin-top:14px;">
  <strong><i class="fa fa-lightbulb-o"></i> Example:</strong>
  Want to know how to create a new invoice? Find the row with method POST and path core/invoices - call that exact URL with your token and the customer/items data.
</div>
';

$lang['api_gateway_help_title_logs'] = 'Request Logs Help';
$lang['api_gateway_help_body_logs'] = '
<ol>
  <li>Every request made through the gateway - successful or not - is recorded here with time, token, path, and status code.</li>
  <li>If an external tool behaves unexpectedly (e.g. repeated errors), check the exact error message here.</li>
</ol>
<div class="alert alert-info" style="margin-top:14px;">
  <strong><i class="fa fa-lightbulb-o"></i> Example:</strong>
  Your agent reports it failed to create an invoice. Filter the recent requests by that token and check the status code / error message.
</div>
';

$lang['api_gateway_help_title_webhooks'] = 'Outbound Webhooks Help';
$lang['api_gateway_help_body_webhooks'] = '
<ol>
  <li>Instead of an external tool constantly polling "has anything changed?", important CRM events are POSTed to your URL the moment they happen.</li>
  <li>The event pattern can be exact (one specific event), end with a star (every event of one module), or just `*` (everything).</li>
  <li>If you set a signing secret, the receiving system can verify the request truly came from this CRM by computing an HMAC-SHA256 over the request body.</li>
</ol>
<div class="alert alert-info" style="margin-top:14px;">
  <strong><i class="fa fa-lightbulb-o"></i> Example:</strong>
  You want an external reporting system notified whenever an accounting document is confirmed. Create a webhook with event pattern "exir_accounting.document_confirmed" and your service\'s URL.
</div>
';
