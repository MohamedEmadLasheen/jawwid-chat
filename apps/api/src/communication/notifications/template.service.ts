import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';

/**
 * Bilingual, versioned templates. Notification text never lives in a
 * controller; it lives in chat.notification_template and is rendered here.
 */
@Injectable()
export class TemplateService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Renders the newest active template for (key, locale), falling back to
   * Arabic - the academy's primary language - if the requested locale has none.
   */
  async render(
    key: string,
    locale: string,
    variables: Record<string, unknown>,
  ): Promise<{ title: string; body: string } | null> {
    const template =
      (await this.find(key, locale)) ?? (locale === 'ar' ? null : await this.find(key, 'ar'));
    if (!template) return null;

    return {
      title: TemplateService.interpolate(template.title, variables),
      body: TemplateService.interpolate(template.body, variables),
    };
  }

  private find(key: string, locale: string) {
    return this.prisma.notificationTemplate.findFirst({
      where: { key, locale, isActive: true },
      orderBy: { version: 'desc' },
    });
  }

  /**
   * Substitutes {placeholders}. An unknown placeholder is left as-is rather
   * than rendered as "undefined", so a template bug is visible instead of
   * silently producing broken copy for a parent.
   */
  static interpolate(text: string, variables: Record<string, unknown>): string {
    return text.replace(/\{(\w+)\}/g, (match, name: string) => {
      const value = variables[name];
      return value === undefined || value === null ? match : String(value);
    });
  }
}
