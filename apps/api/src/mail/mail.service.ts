import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * SMTP sender (Spec §12 — generic SMTP; Mailhog in dev). Actual sending is driven
 * from the BullMQ email queue so an HTTP request never blocks on it (Spec §11).
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter!: nodemailer.Transporter;
  private from!: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const host = this.config.get<string>('SMTP_HOST', 'localhost');
    const port = this.config.get<number>('SMTP_PORT', 1025);
    const user = this.config.get<string>('SMTP_USER', '');
    const pass = this.config.get<string>('SMTP_PASSWORD', '');
    this.from = this.config.get<string>('SMTP_FROM', 'Rademics ERP <no-reply@rademics.local>');

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // implicit TLS on 465; STARTTLS (secure:false) on 587/25
      auth: user ? { user, pass } : undefined,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text ?? stripHtml(message.html),
    });
    this.logger.log(`Email sent to ${message.to}: "${message.subject}"`);
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
