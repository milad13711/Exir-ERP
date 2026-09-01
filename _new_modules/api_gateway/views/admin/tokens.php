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
          <button type="button" class="btn btn-info pull-right mright10" data-toggle="modal" data-target="#new_token_modal">
            <i class="fa fa-plus"></i> <?php echo _l('api_gateway_new_token'); ?>
          </button>
          <h4><?php echo $title; ?></h4>
        </div>
        <div class="clearfix"></div>

        <div class="modal fade" id="api_gateway_help_modal" tabindex="-1">
          <div class="modal-dialog modal-lg">
            <div class="modal-content">
              <div class="modal-header">
                <button type="button" class="close" data-dismiss="modal">&times;</button>
                <h4 class="modal-title"><i class="fa fa-question-circle"></i> <?php echo _l('api_gateway_help_title_tokens'); ?></h4>
              </div>
              <div class="modal-body"><?php echo _l('api_gateway_help_body_tokens'); ?></div>
              <div class="modal-footer">
                <button type="button" class="btn btn-default" data-dismiss="modal"><?php echo _l('close'); ?></button>
              </div>
            </div>
          </div>
        </div>

        <?php if (!empty($new_token)) { ?>
        <div class="alert alert-warning">
          <strong><i class="fa fa-exclamation-triangle"></i> <?php echo _l('api_gateway_token_show_once_title'); ?></strong>
          <p><?php echo _l('api_gateway_token_show_once_body'); ?></p>
          <div class="input-group">
            <input type="text" class="form-control" id="api_gateway_new_token_field" value="<?php echo e($new_token); ?>" readonly dir="ltr" style="font-family:monospace;">
            <span class="input-group-btn">
              <button class="btn btn-default" type="button" onclick="document.getElementById('api_gateway_new_token_field').select(); document.execCommand('copy');">
                <i class="fa fa-copy"></i> <?php echo _l('api_gateway_copy'); ?>
              </button>
            </span>
          </div>
        </div>
        <?php } ?>

        <div class="modal fade" id="new_token_modal" tabindex="-1">
          <div class="modal-dialog">
            <div class="modal-content">
              <?php echo form_open(admin_url('api_gateway/tokens')); ?>
              <div class="modal-header">
                <button type="button" class="close" data-dismiss="modal">&times;</button>
                <h4 class="modal-title"><?php echo _l('api_gateway_new_token'); ?></h4>
              </div>
              <div class="modal-body">
                <div class="form-group">
                  <label><?php echo _l('api_gateway_token_name'); ?></label>
                  <input type="text" class="form-control" name="name" required placeholder="<?php echo _l('api_gateway_token_name_placeholder'); ?>">
                </div>
                <div class="form-group">
                  <label><?php echo _l('api_gateway_acting_staff'); ?></label>
                  <select class="form-control" name="acting_staff_id">
                    <option value=""><?php echo _l('api_gateway_acting_staff_none'); ?></option>
                    <?php foreach ($staff_list as $s) { ?>
                      <option value="<?php echo $s['staffid']; ?>"><?php echo e($s['firstname'] . ' ' . $s['lastname']); ?></option>
                    <?php } ?>
                  </select>
                  <small class="text-muted"><?php echo _l('api_gateway_acting_staff_hint'); ?></small>
                </div>
                <div class="form-group">
                  <label><?php echo _l('api_gateway_token_scope'); ?></label>
                  <div class="radio">
                    <label><input type="radio" name="scopes" value="all" checked onchange="document.getElementById('api_gateway_module_scopes').style.display='none';"> <?php echo _l('api_gateway_scope_all'); ?></label>
                  </div>
                  <div class="radio">
                    <label><input type="radio" name="scopes" value="custom" onchange="document.getElementById('api_gateway_module_scopes').style.display='block';"> <?php echo _l('api_gateway_scope_custom'); ?></label>
                  </div>
                  <div id="api_gateway_module_scopes" style="display:none; margin-right:20px; margin-top:8px;">
                    <?php foreach ($available_modules as $m) { ?>
                      <div class="checkbox">
                        <label><input type="checkbox" name="module_scopes[]" value="<?php echo e($m); ?>"> <?php echo e($m); ?></label>
                      </div>
                    <?php } ?>
                  </div>
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
                    <th><?php echo _l('api_gateway_token_name'); ?></th>
                    <th><?php echo _l('api_gateway_token_preview'); ?></th>
                    <th><?php echo _l('api_gateway_token_scope'); ?></th>
                    <th><?php echo _l('api_gateway_acting_staff'); ?></th>
                    <th><?php echo _l('api_gateway_col_status'); ?></th>
                    <th><?php echo _l('api_gateway_last_used'); ?></th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <?php foreach ($tokens as $t) {
                    $staff_name = '-';
                    foreach ($staff_list as $s) {
                        if ($s['staffid'] == $t['acting_staff_id']) {
                            $staff_name = trim($s['firstname'] . ' ' . $s['lastname']);
                            break;
                        }
                    }
                  ?>
                  <tr>
                    <td><?php echo e($t['name']); ?></td>
                    <td dir="ltr" class="text-left"><code>...<?php echo e($t['token_preview']); ?></code></td>
                    <td><?php echo $t['scopes'] === '*' ? _l('api_gateway_scope_all') : e($t['scopes']); ?></td>
                    <td><?php echo e($staff_name); ?></td>
                    <td>
                      <?php if ($t['status'] === 'active') { ?>
                        <span class="label label-success"><?php echo _l('api_gateway_active'); ?></span>
                      <?php } else { ?>
                        <span class="label label-default"><?php echo _l('api_gateway_revoked'); ?></span>
                      <?php } ?>
                    </td>
                    <td><?php echo $t['last_used_at'] ? _dt($t['last_used_at']) : '-'; ?></td>
                    <td class="text-right">
                      <?php if ($t['status'] === 'active') { ?>
                        <a href="<?php echo admin_url('api_gateway/token_revoke/' . $t['id']); ?>" class="btn btn-default btn-icon"
                           onclick="return confirm('<?php echo _l('api_gateway_confirm_revoke'); ?>');" title="<?php echo _l('api_gateway_revoke'); ?>">
                          <i class="fa fa-ban"></i>
                        </a>
                      <?php } ?>
                      <a href="<?php echo admin_url('api_gateway/token_delete/' . $t['id']); ?>" class="btn btn-default btn-icon"
                         onclick="return confirm('<?php echo _l('confirm_delete'); ?>');" title="<?php echo _l('delete'); ?>">
                        <i class="fa fa-trash"></i>
                      </a>
                    </td>
                  </tr>
                  <?php } ?>
                  <?php if (empty($tokens)) { ?>
                  <tr><td colspan="7" class="text-center"><?php echo _l('no_records_found', ''); ?></td></tr>
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
<?php if (!empty($new_token)) { ?>
<script>$(function(){ $('#new_token_modal').modal('hide'); });</script>
<?php } ?>
<?php init_tail(); ?>
