<?php defined('BASEPATH') or exit('No direct script access allowed'); ?>
<?php init_head(); ?>
<div id="wrapper">
  <div class="content">
    <div class="row">
      <div class="col-md-12">
        <div class="_buttons mbot15">
          <button type="button" class="btn btn-default pull-right" data-toggle="modal" data-target="#api_gateway_help_modal">
            <i class="fa fa-question-circle"></i> <?php echo _l('api_gateway_help_btn'); ?>
          </button>
          <a href="<?php echo admin_url('api_gateway/tokens'); ?>" class="btn btn-info pull-right mright10">
            <i class="fa fa-key"></i> <?php echo _l('api_gateway_menu_tokens'); ?>
          </a>
          <h4><?php echo $title; ?></h4>
        </div>
        <div class="clearfix"></div>

        <div class="modal fade" id="api_gateway_help_modal" tabindex="-1">
          <div class="modal-dialog modal-lg">
            <div class="modal-content">
              <div class="modal-header">
                <button type="button" class="close" data-dismiss="modal">&times;</button>
                <h4 class="modal-title"><i class="fa fa-question-circle"></i> <?php echo _l('api_gateway_help_title_index'); ?></h4>
              </div>
              <div class="modal-body"><?php echo _l('api_gateway_help_body_index'); ?></div>
              <div class="modal-footer">
                <button type="button" class="btn btn-default" data-dismiss="modal"><?php echo _l('close'); ?></button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="row">
      <div class="col-md-4 col-sm-6">
        <div class="panel_s"><div class="panel-body text-center">
          <h2><?php echo (int) $tokens_count; ?></h2>
          <p class="text-muted"><?php echo _l('api_gateway_active_tokens'); ?></p>
        </div></div>
      </div>
      <div class="col-md-4 col-sm-6">
        <div class="panel_s"><div class="panel-body text-center">
          <h2><?php echo (int) $endpoints_count; ?></h2>
          <p class="text-muted"><?php echo _l('api_gateway_registered_endpoints'); ?> (<?php echo count($endpoints); ?> <?php echo _l('api_gateway_modules'); ?>)</p>
        </div></div>
      </div>
      <div class="col-md-4 col-sm-6">
        <div class="panel_s"><div class="panel-body text-center">
          <h2><?php echo (int) $requests_today; ?></h2>
          <p class="text-muted"><?php echo _l('api_gateway_requests_today'); ?></p>
        </div></div>
      </div>
    </div>

    <div class="row">
      <div class="col-md-12">
        <div class="panel_s">
          <div class="panel-body">
            <h4><?php echo _l('api_gateway_recent_requests'); ?></h4>
            <hr>
            <div class="table-responsive">
              <table class="table table-striped">
                <thead>
                  <tr>
                    <th><?php echo _l('api_gateway_col_time'); ?></th>
                    <th><?php echo _l('api_gateway_col_method'); ?></th>
                    <th><?php echo _l('api_gateway_col_path'); ?></th>
                    <th><?php echo _l('api_gateway_col_module'); ?></th>
                    <th><?php echo _l('api_gateway_col_status'); ?></th>
                    <th><?php echo _l('api_gateway_col_duration'); ?></th>
                  </tr>
                </thead>
                <tbody>
                  <?php foreach ($recent_logs as $log) { ?>
                  <tr>
                    <td><?php echo _dt($log['created_at']); ?></td>
                    <td><span class="label label-default"><?php echo e($log['method']); ?></span></td>
                    <td dir="ltr" class="text-left"><code><?php echo e($log['path']); ?></code></td>
                    <td><?php echo e($log['module_name'] ?: '-'); ?></td>
                    <td>
                      <span class="label label-<?php echo $log['status_code'] < 300 ? 'success' : ($log['status_code'] < 500 ? 'warning' : 'danger'); ?>">
                        <?php echo (int) $log['status_code']; ?>
                      </span>
                    </td>
                    <td><?php echo (int) $log['duration_ms']; ?> ms</td>
                  </tr>
                  <?php } ?>
                  <?php if (empty($recent_logs)) { ?>
                  <tr><td colspan="6" class="text-center"><?php echo _l('no_records_found', ''); ?></td></tr>
                  <?php } ?>
                </tbody>
              </table>
            </div>
            <a href="<?php echo admin_url('api_gateway/logs'); ?>"><?php echo _l('api_gateway_view_all_logs'); ?> &larr;</a>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
<?php init_tail(); ?>
