import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FollowUpReminderController } from './follow-up-reminder.controller';
import { FollowUpReminderService } from './follow-up-reminder.service';

describe('FollowUpReminderController', () => {
  const sendDueReminders = jest.fn().mockResolvedValue(2);
  const make = (secret?: string) =>
    new FollowUpReminderController(
      { sendDueReminders } as unknown as FollowUpReminderService,
      { get: () => secret } as unknown as ConfigService,
    );

  beforeEach(() => sendDueReminders.mockClear());

  it('올바른 시크릿이면 발송하고 건수를 반환한다', async () => {
    await expect(make('s3cret').run('s3cret')).resolves.toEqual({ sent: 2 });
    expect(sendDueReminders).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['틀린 시크릿', 's3cret', 'wrong'],
    ['헤더 없음', 's3cret', undefined],
    ['서버 시크릿 미설정', undefined, 'anything'],
  ])('%s이면 401', async (_, expected, given) => {
    await expect(make(expected).run(given)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(sendDueReminders).not.toHaveBeenCalled();
  });
});
