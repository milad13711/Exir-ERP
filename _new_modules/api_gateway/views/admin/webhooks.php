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
          <button type="button" class="btn btn-info pull-right mright10" data-toggle="modal" data-target="#new_webhook_modal">
            <i class="fa fa-plus"></i> <?php echo _l('api_gateway_new_webhook'); ?>
          </button>
          <h4><?php echo $title; ?></h4>
        </div>
        <div class="clearfix"></div>

        <div class="modal fade" id="api_gateway_help_modal" tabindex="-1">
          <div class="modal-dialog modal-lg">
            <div class="modal-content">
              <div class="modal-header">
                <button type="button" class="close" data-dismiss="modal">&times;</button>
                <h4 class="modal-title"><i class="fa fa-question-circle"></i> <?php echo _l('api_gateway_help_title_webhooks'); ?></h4>
              </div>
              <div class="modal-body"><?php echo _l('api_gateway_help_body_webhooks'); ?></div>
              <div class="modal-footer">
                <button type="button" class="btn btn-default" data-dismiss="modal"><?php echo _l('close'); ?></button>
              </div>
            </div>
          </div>
        </div>

        <div class="modal fade" id="new_webhook_modal" tabindex="-1">
          <div class="modal-dialog">
            <div class="modal-content">
              <?php echo form_open(admin_url('api_gateway/webhooks')); ?>
              <div class="modal-header">
                <button type="button" class="close" data-dismiss="modal">&times;</button>
                <h4 class="modal-title"><?php echo _l('api_gateway_new_webhook'); ?></h4>
              </div>
              <div class="modal-body">
                <div class="form-group">
                  <label><?php echo _l('api_gateway_webhook_name'); ?></label>
                  <input type="text" class="form-control" name="name" required>
                </div>
                <div class="form-group">
                  <label><?php echo _l('api_gateway_webhook_event_pattern'); ?></label>
                  <input type="text" class="form-control" name="event_pattern" dir="ltr" required placeholder="eta_production.* یا *">
                  <small class="text-muted"><?php echo _l('api_gateway_webhook_event_pattern_hint'); ?></small>
                </div>
                <div class="form-group">
                  <label><?php echo _l('api_gateway_webhook_url'); ?></label>
                  <input type="text" class="form-control" name="endpoint_url" dir="ltr" required placeholder="https://...">
                </div>
                <div class="form-group">
                  <label><?php echo _l('api_gateway_webhook_secret'); ?></label>
                  <input type="text" class="form-control" name="secret" dir="ltr">
                  <small class="text-muted"><?php echo _l('api_gateway_webhook_secret_hint'); ?></small>
                </div>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-default" data-dismiss="modal"><?php echo _l('close'); ?></button>
                <button type="submit" class="btn btn-primary"><?php echo _l('submit'); ?></button>
              </div>
              <?php echo form_close(); ?>
            </div>
          </div>
        </div>

        <div class="panel_s">
          <div class="panel-body">
            <div class="table-responsive">
              <table class="table table-striped">
                <thead>
                  <tr>
                    <th><?php echo _l('api_gateway_webhook_name'); ?></th>
                    <th><?php echo _l('api_gateway_webhook_event_pattern'); ?></th>
                    <th><?php echo _l('api_gateway_webhook_url'); ?></th>
                    <th><?php echo _l('api_gateway_col_status'); ?></th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <?php foreach ($webhooks as $w) { ?>
                  <tr>
                    <td><?php echo e($w['name']); ?></td>
                    <td dir="ltr" class="text-left"><code><?php echo e($w['event_pattern']); ?></code></td>
                    <td dir="ltr" class="text-left"><code><?php echo e($w['endpoint_url']); ?></code></td>
                    <td>
                      <a href="<?php echo admin_url('api_gateway/webhook_toggle/' . $w['id']); ?>">
                        <span class="label label-<?php echo $w['status'] === 'active' ? 'success' : 'default'; ?>">
                          <?php echo $w['status'] === 'active' ? _l('api_gateway_active') : _l('api_gateway_inactive'); ?>
                        </span>
                      </a>
                    </td>
                    <td class="text-right">
                      <a href="<?php echo admin_url('api_gateway/webhook_delete/' . $w['id']); ?>" class="btn btn-default btn-icon"
                         onclick="return confirm('<?php echo _l('confirm_delete'); ?>');" title="<?php echo _l('delete'); ?>">
                        <i class="fa fa-trash"></i>
                      </a>
                    </td>
                  </tr>
                  <?php } ?>
                  <?php if (empty($webhooks)) { ?>
                  <tr><td colspan="5" class="text-center"><?php echo _l('no_records_found', ''); ?></td></tr>
                  <?php } ?>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
<?php init_tail(); ?>
