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
          <h4><?php echo $title; ?></h4>
        </div>
        <div class="clearfix"></div>

        <div class="modal fade" id="api_gateway_help_modal" tabindex="-1">
          <div class="modal-dialog modal-lg">
            <div class="modal-content">
              <div class="modal-header">
                <button type="button" class="close" data-dismiss="modal">&times;</button>
                <h4 class="modal-title"><i class="fa fa-question-circle"></i> <?php echo _l('api_gateway_help_title_logs'); ?></h4>
              </div>
              <div class="modal-body"><?php echo _l('api_gateway_help_body_logs'); ?></div>
              <div class="modal-footer">
                <button type="button" class="btn btn-default" data-dismiss="modal"><?php echo _l('close'); ?></button>
              </div>
            </div>
          </div>
        </div>

        <div class="panel_s">
          <div class="panel-body">
            <div class="table-responsive">
              <table class="table table-striped">
                <thead>
                  <tr>
                    <th><?php echo _l('api_gateway_col_time'); ?></th>
                    <th><?php echo _l('api_gateway_token_name'); ?></th>
                    <th><?php echo _l('api_gateway_col_method'); ?></th>
                    <th><?php echo _l('api_gateway_col_path'); ?></th>
                    <th><?php echo _l('api_gateway_col_module'); ?></th>
                    <th><?php echo _l('api_gateway_col_status'); ?></th>
                    <th><?php echo _l('api_gateway_col_duration'); ?></th>
                    <th><?php echo _l('api_gateway_col_ip'); ?></th>
                  </tr>
                </thead>
                <tbody>
                  <?php foreach ($logs as $log) {
                    $token_name = '-';
                    foreach ($tokens as $t) {
                        if ($t['id'] == $log['token_id']) {
                            $token_name = $t['name'];
                            break;
                        }
                    }
                  ?>
                  <tr>
                    <td><?php echo _dt($log['created_at']); ?></td>
                    <td><?php echo e($token_name); ?></td>
                    <td><span class="label label-default"><?php echo e($log['method']); ?></span></td>
                    <td dir="ltr" class="text-left"><code><?php echo e($log['path']); ?></code></td>
                    <td><?php echo e($log['module_name'] ?: '-'); ?></td>
                    <td>
                      <span class="label label-<?php echo $log['status_code'] < 300 ? 'success' : ($log['status_code'] < 500 ? 'warning' : 'danger'); ?>">
                        <?php echo (int) $log['status_code']; ?>
                      </span>
                      <?php if ($log['error_message']) { ?>
                        <br><small class="text-danger"><?php echo e($log['error_message']); ?></small>
                      <?php } ?>
                    </td>
                    <td><?php echo (int) $log['duration_ms']; ?> ms</td>
                    <td dir="ltr"><?php echo e($log['ip']); ?></td>
                  </tr>
                  <?php } ?>
                  <?php if (empty($logs)) { ?>
                  <tr><td colspan="8" class="text-center"><?php echo _l('no_records_found', ''); ?></td></tr>
                  <?php } ?>
                </tbody>
              </table>
            </div>

            <?php $total_pages = (int) ceil($total / $per_page); ?>
            <?php if ($total_pages > 1) { ?>
            <ul class="pagination">
              <?php for ($p = 1; $p <= $total_pages; $p++) { ?>
                <li class="<?php echo $p == $page ? 'active' : ''; ?>">
                  <a href="<?php echo admin_url('api_gateway/logs?page=' . $p); ?>"><?php echo $p; ?></a>
                </li>
              <?php } ?>
            </ul>
            <?php } ?>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
<?php init_tail(); ?>
