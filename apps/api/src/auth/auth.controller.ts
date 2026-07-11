import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthService, type IssuedTokens } from './auth.service';
import { ForgotPasswordDto, InviteUserDto, LoginDto, SetPasswordDto } from './dto';
import { CurrentUser, Public } from './decorators';
import { RequireCapability } from '../rbac/capability.decorator';
import type { AuthUser } from './auth-user';

const REFRESH_COOKIE = 'rademics_rt';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.auth.login(dto.email, dto.password, meta(req));
    return this.respondWithTokens(res, tokens);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    const tokens = await this.auth.refresh(raw ?? '', meta(req));
    return this.respondWithTokens(res, tokens);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    await this.auth.logout(raw, meta(req));
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(202)
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request): Promise<{ ok: true }> {
    await this.auth.forgotPassword(dto.email, meta(req));
    return { ok: true };
  }

  @Public()
  @Post('set-password')
  @HttpCode(204)
  async setPassword(@Body() dto: SetPasswordDto, @Req() req: Request): Promise<void> {
    await this.auth.setPasswordFromToken(dto.token, dto.password, meta(req));
  }

  @Public()
  @Post('reset-password')
  @HttpCode(204)
  async resetPassword(@Body() dto: SetPasswordDto, @Req() req: Request): Promise<void> {
    await this.auth.resetPassword(dto.token, dto.password, meta(req));
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  /** Inviting a user is "Create / edit employee" (Spec §3). */
  @Post('invite')
  @RequireCapability('people.employee.create_edit')
  async invite(
    @Body() dto: InviteUserDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<{ id: string }> {
    return this.auth.invite(
      actor,
      { email: dto.email, name: dto.name, role: dto.role, resourceType: dto.resourceType },
      meta(req),
    );
  }

  private respondWithTokens(res: Response, tokens: IssuedTokens) {
    const isProd = this.config.get<string>('NODE_ENV') === 'production';
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    return { accessToken: tokens.accessToken, user: tokens.user };
  }
}

function meta(req: Request): { ip?: string | null; userAgent?: string | null } {
  return { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null };
}
