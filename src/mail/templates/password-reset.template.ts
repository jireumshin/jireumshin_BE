export function passwordResetEmail(nickname: string, resetUrl: string): string {
  return `
<div style="margin:0;padding:24px 12px;background:#FDF6E3;font-family:'Apple SD Gothic Neo',-apple-system,BlinkMacSystemFont,'Malgun Gothic',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:468px;margin:0 auto;border-collapse:separate;">
    <tr>
      <td style="background:#FFD93D;border:3px solid #1A1A1A;border-radius:14px 14px 0 0;padding:18px 20px;text-align:center;">
        <span style="font-size:22px;font-weight:800;color:#1A1A1A;letter-spacing:-0.5px;">⚖️ 지름신 재판소</span>
      </td>
    </tr>
    <tr>
      <td style="background:#FFFDF5;border:3px solid #1A1A1A;border-top:none;border-radius:0 0 14px 14px;padding:28px 24px;">
        <p style="margin:0 0 6px;font-size:19px;font-weight:800;color:#1A1A1A;">🔑 비밀번호 재설정</p>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#4A4A4A;">
          ${nickname}님, 아래 버튼을 눌러 새 비밀번호를 설정해주세요.
        </p>

        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 20px;">
          <tr>
            <td style="background:#E63946;border:3px solid #1A1A1A;border-radius:12px;">
              <a href="${resetUrl}" style="display:block;padding:14px 30px;font-size:16px;font-weight:800;color:#FFFFFF;text-decoration:none;">
                비밀번호 재설정하기
              </a>
            </td>
          </tr>
        </table>

        <p style="margin:0 0 18px;font-size:13px;line-height:1.7;color:#7A7A7A;">
          이 링크는 <strong style="color:#1A1A1A;">30분 뒤 만료</strong>되고 한 번만 사용할 수 있어요.<br />
          비밀번호 재설정을 요청한 적이 없다면 이 메일은 무시하셔도 됩니다.
        </p>

        <p style="margin:0;padding-top:16px;border-top:2px dashed #D9D2BF;font-size:11px;line-height:1.6;color:#9A9A9A;word-break:break-all;">
          버튼이 눌리지 않으면 아래 주소를 브라우저에 붙여넣어주세요<br />
          <span style="color:#7A6FF0;">${resetUrl}</span>
        </p>
      </td>
    </tr>
  </table>
</div>`.trim();
}
