import { ConflictException, Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { safeDelete } from '../common/safe-delete.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { RecruitmentService, RECRUITMENT_MODULE_CODE } from './recruitment.service.js';
import { RecruitmentOfferPdfService } from './recruitment-offer-pdf.service.js';
import { CreateJobPostingDto } from './dto/create-job-posting.dto.js';
import { UpdateJobPostingDto } from './dto/update-job-posting.dto.js';
import { CreateApplicantDto } from './dto/create-applicant.dto.js';
import { UpdateApplicantDto } from './dto/update-applicant.dto.js';
import { DecisionDto } from './dto/decision.dto.js';
import { ScheduleInterviewDto } from './dto/schedule-interview.dto.js';
import { UpdateInterviewDto } from './dto/update-interview.dto.js';
import { RecordInterviewReportDto } from './dto/record-interview-report.dto.js';
import { CreateOfferDto } from './dto/create-offer.dto.js';
import { HireApplicantDto } from './dto/hire-applicant.dto.js';
import { UpdateRecruitmentGeneralSettingsDto, UpdateRecruitmentSmsSettingsDto } from './dto/update-settings.dto.js';

@Controller('recruitment')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule(RECRUITMENT_MODULE_CODE)
export class RecruitmentController {
  constructor(
    private readonly recruitment: RecruitmentService,
    private readonly offerPdf: RecruitmentOfferPdfService,
    private readonly permissions: PermissionsService,
    private readonly controlDb: ControlPrismaService,
  ) {}

  /* آگهی‌ها */

  @Get('postings')
  async listPostings(@Query('status') status: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, RECRUITMENT_MODULE_CODE);
    return this.recruitment.listPostings(ctx, status);
  }

  @Get('postings/:id')
  async postingDetail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, RECRUITMENT_MODULE_CODE);
    return this.recruitment.postingDetail(ctx, id);
  }

  @Get('postings/:id/report')
  async postingReport(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, RECRUITMENT_MODULE_CODE);
    return this.recruitment.postingReport(ctx, id);
  }

  @Post('postings')
  async createPosting(@Body() dto: CreateJobPostingDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, RECRUITMENT_MODULE_CODE);
    return this.recruitment.createPosting(ctx, dto);
  }

  @Delete('postings/:id')
  async removePosting(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, RECRUITMENT_MODULE_CODE);
    await safeDelete(() => ctx.tenantDb.jobPosting.delete({ where: { id } }));
    return { success: true };
  }

  @Delete('applicants/:id')
  async removeApplicant(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, RECRUITMENT_MODULE_CODE);
    const a = await ctx.tenantDb.jobApplicant.findUnique({ where: { id } });
    if (a?.stage === 'HIRED') throw new ConflictException('متقاضی جذب‌شده حذف نمی‌شود؛ پرونده‌ی پرسنلی او در منابع انسانی است');
    await safeDelete(() => ctx.tenantDb.jobApplicant.delete({ where: { id } }));
    return { success: true };
  }

  @Patch('postings/:id')
  async updatePosting(@Param('id') id: string, @Body() dto: UpdateJobPostingDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, RECRUITMENT_MODULE_CODE);
    return this.recruitment.updatePosting(ctx, id, dto);
  }

  @Post('postings/:id/close')
  async closePosting(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, RECRUITMENT_MODULE_CODE);
    return this.recruitment.closePosting(ctx, id);
  }

  /* متقاضیان */

  @Get('applicants')
  async listApplicants(
    @Query('jobPostingId') jobPostingId: string | undefined,
    @Query('stage') stage: string | undefined,
    @Query('search') search: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertView(ctx, RECRUITMENT_MODULE_CODE);
    return this.recruitment.listApplicants(ctx, { jobPostingId, stage, search });
  }

  @Get('applicants/:id')
  async applicantDetail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, RECRUITMENT_MODULE_CODE);
    return this.recruitment.applicantDetail(ctx, id);
  }

  @Post('applicants')
  async createApplicant(@Body() dto: CreateApplicantDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, RECRUITMENT_MODULE_CODE);
    return this.recruitment.createApplicant(ctx, dto);
  }

  @Patch('applicants/:id')
  async updateApplicant(@Param('id') id: string, @Body() dto: UpdateApplicantDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, RECRUITMENT_MODULE_CODE);
    return this.recruitment.updateApplicant(ctx, id, dto);
  }

  @Post('applicants/:id/specialist-decision')
  async specialistDecision(@Param('id') id: string, @Body() dto: DecisionDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, RECRUITMENT_MODULE_CODE);
    return this.recruitment.specialistDecision(ctx, id, dto);
  }

  @Post('applicants/:id/management-decision')
  async managementDecision(@Param('id') id: string, @Body() dto: DecisionDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, RECRUITMENT_MODULE_CODE);
    return this.recruitment.managementDecision(ctx, id, dto);
  }

  @Post('applicants/:id/hire')
  async hireApplicant(@Param('id') id: string, @Body() dto: HireApplicantDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, RECRUITMENT_MODULE_CODE);
    return this.recruitment.hireApplicant(ctx, id, dto);
  }

  /* مصاحبه‌ها */

  @Get('interviews')
  async listInterviews(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('interviewerUserId') interviewerUserId: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertView(ctx, RECRUITMENT_MODULE_CODE);
    return this.recruitment.listInterviews(ctx, { from, to, interviewerUserId });
  }

  @Post('interviews')
  async scheduleInterview(@Body() dto: ScheduleInterviewDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, RECRUITMENT_MODULE_CODE);
    return this.recruitment.scheduleInterview(ctx, dto);
  }

  @Patch('interviews/:id')
  async updateInterview(@Param('id') id: string, @Body() dto: UpdateInterviewDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, RECRUITMENT_MODULE_CODE);
    return this.recruitment.updateInterview(ctx, id, dto);
  }

  @Post('interviews/:id/cancel')
  async cancelInterview(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, RECRUITMENT_MODULE_CODE);
    return this.recruitment.cancelInterview(ctx, id);
  }

  @Post('interviews/:id/report')
  async recordInterviewReport(@Param('id') id: string, @Body() dto: RecordInterviewReportDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, RECRUITMENT_MODULE_CODE);
    return this.recruitment.recordInterviewReport(ctx, id, dto);
  }

  /* شرایط همکاری */

  @Get('applicants/:id/offer')
  async getOffer(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, RECRUITMENT_MODULE_CODE);
    return this.recruitment.getOfferForApplicant(ctx, id);
  }

  @Post('applicants/:id/offer')
  async createOffer(@Param('id') id: string, @Body() dto: CreateOfferDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, RECRUITMENT_MODULE_CODE);
    return this.recruitment.createOrUpdateOffer(ctx, id, dto);
  }

  @Post('offers/:id/send')
  async sendOffer(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, RECRUITMENT_MODULE_CODE);
    return this.recruitment.sendOffer(ctx, id);
  }

  @Get('offers/:id/pdf')
  async downloadOfferPdf(@Param('id') id: string, @Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertView(ctx, RECRUITMENT_MODULE_CODE);
    const offer = await ctx.tenantDb.jobOffer.findUnique({ where: { id }, include: { applicant: { select: { name: true } }, signedBy: { select: { name: true } } } });
    if (!offer) {
      res.status(404).json({ message: 'این شرایط همکاری یافت نشد' });
      return;
    }
    const [tenant, seal] = await Promise.all([
      this.controlDb.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } }),
      this.recruitment.getCompanySeal(ctx),
    ]);
    const pdf = await this.offerPdf.render(
      {
        applicantName: offer.applicant.name,
        jobDescription: offer.jobDescription,
        collaborationType: offer.collaborationType,
        workingHours: offer.workingHours,
        salary: offer.salary,
        benefits: offer.benefits,
        durationMonths: offer.durationMonths,
        startDate: offer.startDate,
        signedAt: offer.signedAt,
        signedByName: offer.signedBy?.name ?? null,
        candidateSignature: offer.candidateSignature,
      },
      tenant.name,
      // مهر و امضای شرکت فقط وقتی مدیر «تأیید و اجازه‌ی درج مهر و امضا» را زده باشد
      offer.stampApplied ? seal : {},
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="job-offer.pdf"');
    res.send(pdf);
  }

  /* تنظیمات */

  @Get('settings/general')
  async getGeneralSettings(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, RECRUITMENT_MODULE_CODE);
    return this.recruitment.getGeneralSettings(ctx);
  }

  @Put('settings/general')
  async setGeneralSettings(@Body() dto: UpdateRecruitmentGeneralSettingsDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, RECRUITMENT_MODULE_CODE);
    return this.recruitment.setGeneralSettings(ctx, dto);
  }

  @Get('settings/sms')
  async getSmsSettings(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, RECRUITMENT_MODULE_CODE);
    return this.recruitment.getSmsSettings(ctx);
  }

  @Put('settings/sms')
  async setSmsSettings(@Body() dto: UpdateRecruitmentSmsSettingsDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, RECRUITMENT_MODULE_CODE);
    return this.recruitment.setSmsSettings(ctx, dto);
  }

  /** فقط برای پیش‌نمایش/رندر شرایط همکاری — تغییر خودِ مهر/امضا اکنون فقط از Settings → General (فقط مالک) ممکن است. */
  @Get('settings/company-seal')
  async getCompanySeal(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, RECRUITMENT_MODULE_CODE);
    return this.recruitment.getCompanySeal(ctx);
  }
}
