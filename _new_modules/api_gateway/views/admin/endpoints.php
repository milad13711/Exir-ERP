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
                <h4 class="modal-title"><i class="fa fa-question-circle"></i> <?php echo _l('api_gateway_help_title_endpoints'); ?></h4>
              </div>
              <div class="modal-body"><?php echo _l('api_gateway_help_body_endpoints'); ?></div>
              <div class="modal-footer">
                <button type="button" class="btn btn-default" data-dismiss="modal"><?php echo _l('close'); ?></button>
              </div>
            </div>
          </div>
        </div>

        <div class="alert alert-info">
          <?php echo _l('api_gateway_base_url_hint'); ?>
          <br><code dir="ltr"><?php echo e($base_url); ?></code>
        </div>

        <?php foreach ($endpoints as $module_name => $module_endpoints) { ?>
        <div class="panel_s">
          <div class="panel-body">
            <h4><?php echo e($module_name); ?> <span class="label label-default"><?php echo count($module_endpoints); ?></span></h4>
            <hr>
            <div class="table-responsive">
              <table class="table table-striped">
                <thead>
                  <tr>
                    <th><?php echo _l('api_gateway_col_method'); ?></th>
                    <th><?php echo _l('api_gateway_col_path'); ?></th>
                    <th><?php echo _l('api_gateway_col_description'); ?></th>
                    <th><?php echo _l('api_gateway_webhook_events'); ?></th>
                  </tr>
                </thead>
                <tbody>
                  <?php foreach ($module_endpoints as $ep) { ?>
                  <tr>
                    <td>
                      <span class="label label-<?php echo $ep['method'] === 'GET' ? 'info' : ($ep['method'] === 'POST' ? 'success' : 'warning'); ?>">
                        <?php echo e($ep['method']); ?>
                      </span>
                    </td>
                    <td dir="ltr" class="text-left"><code><?php echo e($base_url . '/' . $ep['path']); ?></code></td>
                    <td><?php echo e($ep['description'] ?? '-'); ?></td>
                    <td><?php echo !empty($ep['webhook_events']) ? e(implode(', ', $ep['webhook_events'])) : '-'; ?></td>
                  </tr>
                  <?php } ?>
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <?php } ?>
        <?php if (empty($endpoints)) { ?>
        <div class="panel_s"><div class="panel-body text-center text-muted"><?php echo _l('no_records_found', ''); ?></div></div>
        <?php } ?>
      </div>
    </div>
  </div>
</div>
<?php init_tail(); ?>
